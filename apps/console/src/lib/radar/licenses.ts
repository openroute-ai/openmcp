/**
 * 许可证变更历史。
 *
 * §5.4 的红线 3 之所以能被满足，靠的是这一层而不是 GitHub：仓库信息接口只返回
 * **当前**许可证，「这个项目从 Apache-2.0 换成了 AGPL-3.0」这件事在库里原本根本
 * 不存在。它只靠记住自己每一次看到的值才变成可回答的问题。
 *
 * `observed_at` 是「本系统第一次看到」而不是「变更发生」，这条区分写在了
 * `repoLicenseHistory.observedAt` 的列注释里，而 {@link recordLicenseObservation}
 * 是唯一保证它不被越界解读的地方：写入的是观测时刻，**不是**「把变更时间猜成上次
 * 观测时间」——后者会让一次全量回填之后，系统公开宣称某个三年前的变更是上周发生的。
 */

import { desc, eq } from "drizzle-orm"
import { repoLicenseHistory } from "@/db/schema/github"
import type { Db } from "@/lib/github/service/repo"

/** GitHub 对「没有许可证声明」的返回值，不是 SPDX 标识。 */
const NOASSERTION = "NOASSERTION"

/**
 * 把 GitHub 给的许可证字段规范化成「可以存进历史的值」。
 *
 * 两种输入要合并：仓库根本不带 license 字段（`null`）和 GitHub 明确说
 * `NOASSERTION`（没有可识别的许可证声明）。两者对法务是同一句话，但存成两个不同的
 * 值会让「它是不是刚从 MIT 换成了没有许可证」这条结论永远算不出来——因为它们在
 * 字符串比较里是不同的，而它们在事实上是同一种状态。
 *
 * 规范化成同一个字符串的代价是：以后 GitHub 开始区分这两种情况，我们已经分不开了。
 * 那一天远小于「现在就把两种情况当成同一件事」天天误报「许可证变更」的概率。
 */
export function normalizeLicense(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === "" || trimmed === NOASSERTION) return "NONE"
  return trimmed
}

/**
 * 记下这次观测到的许可证。
 *
 * 返回 `true` 表示这是一个新值（库里还没有），`false` 表示重复观测或无值。
 *
 * **幂等**到「重复观测不写新行」的程度，靠的是 `(repo_id, license)` 主键上的
 * `ON CONFLICT DO NOTHING`。这一点是硬要求而不是优化：`update-github-data` 每次对
 * 全量仓库跑一遍，如果重复观测会插新行，一次回填就会凭空造出成百上千条
 * 「许可证变更」，其中每一条都会变成一条公开的异动。
 *
 * `observedAt` 由调用方传入而不是在这里取 `new Date()`：回填需要用「当时的时刻」，
 * 而 `ON CONFLICT DO NOTHING` 意味着已存在的行不会被这次的值覆盖——重跑一次不会
 * 把一条三个月前的观测改成「刚才」。
 */
export async function recordLicenseObservation(
  db: Db,
  repoId: string,
  license: string | null | undefined,
  observedAt: Date
): Promise<boolean> {
  const normalized = normalizeLicense(license)
  if (normalized === null) return false

  const inserted = await db
    .insert(repoLicenseHistory)
    .values({ repoId, license: normalized, observedAt })
    .onConflictDoNothing()
    .returning({ license: repoLicenseHistory.license })

  return inserted.length > 0
}

/** 一个仓库的许可证历史，从新到旧。 */
export interface LicenseObservation {
  license: string
  observedAt: Date
}

/** 某个仓库的全部许可证观测，最新的在前。 */
export async function listLicenseHistory(
  db: Db,
  repoId: string
): Promise<LicenseObservation[]> {
  const rows = await db
    .select({
      license: repoLicenseHistory.license,
      observedAt: repoLicenseHistory.observedAt,
    })
    .from(repoLicenseHistory)
    .where(eq(repoLicenseHistory.repoId, repoId))
    .orderBy(desc(repoLicenseHistory.observedAt))

  return rows
}

/** 最近一次观测到的许可证，以及它被观测到的时刻。第一次观测返回 null。 */
export async function latestLicenseObservation(
  db: Db,
  repoId: string
): Promise<LicenseObservation | null> {
  const [latest] = await listLicenseHistory(db, repoId)
  return latest ?? null
}

/**
 * 记录这次观测，然后给出「当前值」与「上一个不同的值」。
 *
 * **必须先记录再比较**，否则 `current` 拿不到自己的 `observedAt`，而
 * `detectLicenseChange` 的 `period` 正是这个时刻——它是这条异动唯一的去重键
 * （见 `repo_anomalies` 唯一键与 {@link AnomalyPeriodPolicy}）。顺序反过来会让
 * 每次判定都拿「本次运行时刻」当 period，于是同一次许可证变更每周报一次。
 *
 * `previous` 是**最新的、与当前值不同**的那条观测，而不是「倒数第二条」。在一个
 * 只增不减的历史里这两者是同一件事，但一旦出现 A → B → A 的往复，「倒数第二条」
 * 就会是 A 本身，于是「A 变回了 A」这件事被报成一次变更。
 */
export async function recordAndCompareLicense(
  db: Db,
  repoId: string,
  license: string | null | undefined,
  observedAt: Date
): Promise<{
  current: LicenseObservation | null
  previous: LicenseObservation | null
}> {
  await recordLicenseObservation(db, repoId, license, observedAt)

  const history = await listLicenseHistory(db, repoId)
  const currentValue = normalizeLicense(license)
  const current =
    history.find((entry) => entry.license === currentValue) ?? null
  const previous =
    history.find((entry) => entry.license !== currentValue) ?? null

  return { current, previous }
}

/**
 * 异动的 `period` 该取哪个时刻，取决于它是一条**状态**还是一次**事件**。
 *
 * 周规则（断崖、加速度、停滞）说的是「这一周怎么样」，所以 period 取那一周的起点，
 * 判定周期内重复跑不会产生新行。许可证变更不是状态而是**一次性事件**——它没有
 * 「这一周还在变更」这回事，每一周重新报一次是纯粹的噪音。
 *
 * 所以它取**当前许可证被首次观测到的时刻**。那个时刻对同一次变更是恒定的：即使
 * 有人在两周后重跑判定、即使中间又跑了一百次，它仍然是同一个 `observed_at`，
 * 于是 `(repo_id, kind, period)` 命中已有行、被 `ON CONFLICT DO NOTHING` 吞掉。
 *
 * 代价是这个方案在 A → B → A → B 的往复里会漏掉第二次 B：`repo_license_history`
 * 的主键是 `(repo_id, license)`，它是一张**集合**而不是序列，所以第二次观测到 B 时
 * 拿到的还是第一次的 `observed_at`，去重键与第一次撞在一起。宁可漏报一次往复，
 * 也不要把同一次变更每周报一遍——后者会把整个异动流的信噪比拖垮。
 */
export const AnomalyPeriodPolicy = {
  /** 状态型：最新一周的 `period`。 */
  stateful: "latest-week" as const,
  /** 事件型：新值首次被观测到的时刻。 */
  eventful: "first-observed-at" as const,
}
