/**
 * 生命体征：把一个仓库的存过史压成几个**能被人核对**的当前读数。
 *
 * 与 `rules.ts` 的分工：规则回答「发生了什么变化」，这里回答「现在是什么水平」。
 * 两者共用同一套原始量，但**都拒绝合成一个分数**——§5.4 的红线 1 不是只针对异动的，
 * 是一条全局约束，而榜单与详情页最容易违反它的方式恰恰是把 star 增速、发布节奏和
 * 提交活跃度揉成一个「健康度 78 分」。所以 {@link VitalSnapshot} 里没有一个字段是
 * 分数，每一个都是可以被单独质疑的量。
 *
 * 与 §5.5 的关系：决策工作台把这里的输出**冻结**进候选行，因为回访要问的是
 * 「当时它什么样」。引用这份计算会让那条问题随时间线一起变形。
 */

import { APP_TIMEZONE } from "@/lib/time"
import {
  listWeeklyArrivals,
  type WeeklyArrivals,
} from "@/lib/github/service/stats"
import type { Db } from "@/lib/github/service/repo"

/** 一个体征的方向。红涨绿跌的方向由调用方按语境决定，这里只描述量本身。 */
export type VitalDirection = "up" | "down" | "flat" | "unknown"

/**
 * 一组当前读数。
 *
 * 字段是可选的，而不是取值为 0：没测过和测出 0 是两件事，而把它们合成一个数字
 * 正是「综合分」最早出现的地方（把缺失当 0 参与平均，分数照样算得出来，只是变成
 * 了「假设没数据就是零」的结论）。
 */
export interface VitalSnapshot {
  /**
   * 最近一周的新增 star 数。
   *
   * 优先取 `delta_new_stars`（到达数）而不是 `delta_stars`（净变化）：有人取消 star 的
   * 那一周，到达数仍然如实回答「这周有多少人来了」，而净变化会把那天算成负数。
   *
   * 但到达数只有被 stargazer 扫描覆盖过的仓库才写。没有覆盖到的退到净变化：那是一个
   * 诚实的读数（它记的是 star 总数的变化），而把没测过当成 0
   * 只会把「没记录」说成「这周一个 star 都没来」。两个写者都没记录的周留空。
   */
  starsThisWeek?: number

  /**
   * 相对 `weeksAgo` 周前那一周的倍数。
   *
   * 是一个倍数而不是「增长率 %」，因为星数的基数差异极大：`2 → 8` 是 +300% 也是
   * 4 倍，写成百分比会让人以为这是本季度最大的新闻。倍数在这里读作「快了 4 倍」，
   * 它不声称任何百分比的含义。
   *
   * 基数为 0 或缺测时是 `undefined`：0 → 40 不是无穷倍，是「原来没有量」，把它
   * 渲染成一个数字就是编造。
   */
  starFactor?: number

  /** `starFactor` 的基期是几周前，默认 3。 */
  starFactorWeeksAgo?: number

  /** 距上次发布的天数；从未发布过则 undefined。 */
  daysSinceRelease?: number

  /** 距上次推送的天数。 */
  daysSincePush?: number

  /** 当前 SPDX 许可证标识。 */
  license?: string | null

  /** 最近一周的提交数增量；null 表示这一周没被测过。 */
  commitsThisWeek?: number | null

  /** 取数截止的时刻。冻结快照时它告诉读者这些数字「截至什么时候」。 */
  measuredAt: Date
}

/** 一份体征连同它的方向，供组件直接渲染而不必自己判断正负。 */
export interface Vital extends VitalSnapshot {
  direction: VitalDirection
}

const MS_PER_DAY = 86_400_000

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY))
}

/**
 * 把星数基数为零的情况显式排除，而不是让除法自己决定。
 *
 * `0 → 40` 的倍数是无穷大，而 `Infinity` 会在 JSON 里变成 `null`——一份
 * `starFactor: null` 的快照和一份「基期缺测」的快照读起来一模一样，而它们是不同
 * 的两件事。所以这里返回 `undefined`，让「算不出来」和「算出来是无穷」分开。
 */
function factorOf(latest: number, baseline: number): number | undefined {
  if (baseline <= 0) return undefined
  return Math.round((latest / baseline) * 100) / 100
}

/**
 * 纯计算：把已经取好的数算成体征。
 *
 * 与 {@link readVitals} 分开是为了让这一段能脱离数据库测——阈值和「除以零」这类
 * 边界是这个函数里全部的复杂度，而它们全都依赖真实数据才会暴露。
 */
export function computeVitals(input: {
  weekly: WeeklyArrivals[]
  now: Date
  pushedAt?: Date | null
  lastReleaseAt?: Date | null
  license?: string | null
  starFactorWeeksAgo?: number
}): VitalSnapshot {
  const { weekly, now } = input
  const lookback = input.starFactorWeeksAgo ?? 3
  const latest = weekly[weekly.length - 1]

  const snapshot: VitalSnapshot = { measuredAt: now }

  if (latest) {
    snapshot.starsThisWeek = latest.stars
    snapshot.commitsThisWeek = latest.counters?.commits?.delta ?? null
  }

  // 基期取 `lookback` 周之前的**那一个**元素：`latest` 是 `n-1`，`lookback` 周之前
  // 就是 `n-1-lookback`。取不到就是取不到，不往前再退——退到更早的一周会让这个倍数
  // 回答另一个问题（「比八周前快多少」），而读者看到的是一个没有说明的倍数。
  const baseline = weekly[weekly.length - 1 - lookback]
  const latestGain = latest?.stars
  const baselineGain = baseline?.stars
  if (
    latestGain !== undefined &&
    baselineGain !== undefined &&
    baselineGain > 0
  ) {
    snapshot.starFactor = factorOf(latestGain, baselineGain)
    snapshot.starFactorWeeksAgo = lookback
  }

  if (input.pushedAt) snapshot.daysSincePush = daysBetween(input.pushedAt, now)
  if (input.lastReleaseAt) {
    snapshot.daysSinceRelease = daysBetween(input.lastReleaseAt, now)
  }
  if (input.license !== undefined) snapshot.license = input.license

  return snapshot
}

/**
 * 方向：给组件一个不必自己算的答案。
 *
 * 只有 star 因子有方向，因为只有它是「越大越好」的单向量。发布与推送的间隔是「越小
 * 越好」，把它们塞进同一个 `direction` 会让组件必须知道每个字段的极性，而那正是
 * 一旦加字段就会漏掉的地方——所以方向只覆盖一个字段，另外两个的语义写在字段名上。
 */
export function vitalDirection(snapshot: VitalSnapshot): VitalDirection {
  if (snapshot.starFactor === undefined) return "unknown"
  if (snapshot.starFactor > 1) return "up"
  if (snapshot.starFactor < 1) return "down"
  return "flat"
}

/** 读一个仓库的当前体征。 */
export async function readVitals(
  db: Db,
  repo: {
    id: string
    pushedAt: Date
    latestReleasePublishedAt: Date | null
    licenseSpdxId: string | null
  },
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): Promise<Vital> {
  // 取 12 周而不是 4：因子要的是最近一周对三周前，而发布停滞这类判断会往回看更远。
  // 这个窗口与 `stats.ts` 的 `WEEKLY_ARRIVALS_WINDOW` 一致，理由相同。
  const weekly = await listWeeklyArrivals(db, repo.id, 12, timeZone)

  const snapshot = computeVitals({
    weekly,
    now,
    pushedAt: repo.pushedAt,
    lastReleaseAt: repo.latestReleasePublishedAt,
    license: repo.licenseSpdxId,
  })

  return { ...snapshot, direction: vitalDirection(snapshot) }
}
