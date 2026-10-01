/**
 * 异动的读取与写入。
 *
 * 这一层是「规则」与「数据库」之间唯一的翻译：它把 stats 行读成规则要的形状，跑
 * 规则，再把命中的结论写进 `repo_anomalies`。规则本身不知道数据库的存在，所以它能
 * 被纯函数测试钉住；这一层不知道阈值的存在，所以改阈值不需要动它。
 *
 * **写入是物化的，不是实时的。** §5.4 的红线 1 之所以能做到「阈值变化后旧结论不被
 * 改写」，是因为结论一旦写下就存成一行，之后再读的永远是当时那套阈值下的答案。
 * 代价是：改了阈值要等下一次判定才会生效，而这一点必须在别处（`detect-anomalies`
 * 任务的说明）说出来，否则一个改了阈值的人会以为历史被修好了。
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import {
  type AnomalyKind,
  type AnomalyStatus,
  type EvidencePayload,
  type MetricPayload,
  repoAnomalies,
  repoWeeklyStats,
  repos,
} from "@/db/schema/github"
import type { Db } from "@/lib/github/service/repo"
import { APP_TIMEZONE } from "@/lib/time"
import { weekOfPeriod } from "@/lib/github/snapshot-dates"
import {
  type RadarSubject,
  type RadarWeek,
  type RuleHit,
  evaluate,
} from "./rules"
import { recordAndCompareLicense } from "./licenses"

const MS_PER_DAY = 86_400_000

/**
 * 判定需要回看多少周。
 *
 * 四条周规则最深用到「最近一周对四周前」（提交停滞），四加一等于五；留到 12 是为了
 * 和 `stats.ts` 的 `WEEKLY_ARRIVALS_WINDOW` 一致——同一条历史被两处以不同的长度读取
 * 会让「体征说三周前、异动说五周前」这种不一致看起来像 bug 而不是一个诚实的近似。
 */
const LOOKBACK_WEEKS = 12

/** 一次批量读多少个仓库的周统计。 */
const REPO_CHUNK = 200

/** 判定需要的仓库字段。刻意不含 `licenseSpdxId` 以外的展示字段。 */
export type RadarRepo = Pick<
  typeof repos.$inferSelect,
  "id" | "pushedAt" | "latestReleasePublishedAt" | "licenseSpdxId"
>

/** 一条异动，`repo_anomalies` 的一行，附带它所属的仓库标识。 */
export interface AnomalyWithRepo {
  id: string
  repoId: string
  kind: AnomalyKind
  severity: string
  period: Date
  detectedAt: Date
  title: string
  magnitude: number
  metric: MetricPayload | null
  evidence: EvidencePayload | null
  status: AnomalyStatus
  /**
   * The repository's identity, denormalised in from the join.
   *
   * Carried on every row rather than looked up per consumer: the three readers
   * (the page, the JSON endpoint, the hero feed) all render a link and a star
   * count, and a second round trip per row to fetch what the join already had
   * would be the only reason they can't share one query.
   */
  owner: string
  name: string
  stars: number | null
}

/** 「2026-W03」这样的周标签，只用于写给人看的文本。 */
function weekLabel(period: Date, timeZone: string): string {
  const { year, week } = weekOfPeriod(period, timeZone)
  return `${year}-W${String(week).padStart(2, "0")}`
}

/**
 * 从周统计行造出规则要的周序列，**并检查是否连续**。
 *
 * 连续性在这里检查而不是交给规则，是因为断了的历史会让每一条规则都悄悄改变答案：
 * 「连续三周下降」在缺一周之后读到的是「三周里有两周下降」，而规则看不到它缺了。
 * 静默改变阈值比不判定糟得多，所以宁可不给规则看一个带洞的窗口。
 *
 * 缺的那一周如果它的 `delta_commits` 是 0，理论上仍然可以补出来——但我们不补：补出来
 * 的 0 是我们假设的，不是测到的，而 `commit_stall` 的全部含义就是「四周都是 0」。
 */
function toRadarWeeks(
  rows: (typeof repoWeeklyStats.$inferSelect)[],
  timeZone: string
): { weeks: RadarWeek[]; complete: boolean } {
  const ordered = [...rows].sort(
    (a, b) => a.period.getTime() - b.period.getTime()
  )
  const weeks: RadarWeek[] = ordered.map((row) => ({
    period: row.period,
    label: weekLabel(row.period, timeZone),
    newStars: row.deltaNewStars ?? 0,
    commitDelta: row.deltaCommits ?? null,
    releaseDelta: row.deltaReleases ?? null,
  }))

  const complete =
    weeks.length > 1 &&
    weeks.every(
      (week, index) =>
        index === 0 ||
        week.period.getTime() - weeks[index - 1]!.period.getTime() ===
          7 * MS_PER_DAY
    )

  return { weeks, complete }
}

/**
 * 相邻两次发布之间的天数（7 的倍数）。
 *
 * 从周行的 `delta_releases` 累加：一行只说「这周发了几次」，所以我们只知道事件落在
 * 哪一周，把它记成那一周的周一。于是间隔一定是 7 的整数倍——这是一个近似，`metric`
 * 里的 `intervalIsApproximate` 就是把这件事带出去的地方。
 *
 * 同一周内发两次只产生一个间隔（用那周），因为按周的数据里它们的先后不可知；把
 * 一次周内的多次发布算成 0 天间隔会让中位数被这种项目压到接近 0，进而让它们的
 * 停滞阈值塌到 60 天下限——一个频繁发版的项目正是最不该被判停的那一类。
 */
function releaseIntervals(weeks: RadarWeek[]): number[] {
  const intervals: number[] = []
  let lastReleaseWeek: Date | null = null

  for (const week of weeks) {
    if ((week.releaseDelta ?? 0) <= 0) continue
    if (lastReleaseWeek) {
      intervals.push(
        (week.period.getTime() - lastReleaseWeek.getTime()) / MS_PER_DAY
      )
    }
    lastReleaseWeek = week.period
  }

  return intervals
}

/**
 * 为一批仓库造出规则要的输入。
 *
 * 一次性批量读周统计而不是逐仓库查：一个仓库一次查询在几百个仓库的量级上会把判定
 * 任务从一次索引扫描变成几百次往返，而它每天只跑一次。
 *
 * **周历史不连续时返回 `null`**，规则不会看到一个残缺的窗口。理由见
 * {@link toRadarWeeks}。
 *
 * **归档仓库在这里就被排除**，而不是只靠 `listDetectableRepoIds` 过滤。理由是这一层
 * 才是「什么算一个可判定的对象」的真正定义处：把不变量留在调用方，意味着任何一次
 * 手工重跑、一个后台回填脚本或者未来新写的任务都能绕开它，而绕开的方式是传进一个
 * 仓库 id ——那看起来是完全正常的调用。
 */
export async function buildSubjects(
  db: Db,
  repoIds: string[],
  now: Date,
  timeZone: string = APP_TIMEZONE
): Promise<RadarSubject[]> {
  const byRepo = new Map<string, (typeof repoWeeklyStats.$inferSelect)[]>()
  const repoRows = await db
    .select({
      id: repos.id,
      pushedAt: repos.pushedAt,
      latestReleasePublishedAt: repos.latestReleasePublishedAt,
      licenseSpdxId: repos.licenseSpdxId,
    })
    .from(repos)
    .where(and(inArray(repos.id, repoIds), sql`${repos.archived} is not true`))

  for (let start = 0; start < repoIds.length; start += REPO_CHUNK) {
    const chunk = repoIds.slice(start, start + REPO_CHUNK)
    const rows = await db
      .select()
      .from(repoWeeklyStats)
      .where(inArray(repoWeeklyStats.repoId, chunk))
      .orderBy(desc(repoWeeklyStats.period))

    for (const row of rows) {
      const bucket = byRepo.get(row.repoId) ?? []
      // 每块只保留最近的若干周，否则一个五年历史的仓库会把整批都拖慢。
      if (bucket.length < LOOKBACK_WEEKS) bucket.push(row)
      byRepo.set(row.repoId, bucket)
    }
  }

  const subjects: RadarSubject[] = []
  for (const repo of repoRows) {
    const { weeks, complete } = toRadarWeeks(
      byRepo.get(repo.id) ?? [],
      timeZone
    )
    if (!complete) continue

    // 先记录再比较，顺序不能反：`licenseObservedAt` 是这条异动唯一的去重键，
    // 少了它 `period` 只能退回 `now`，于是同一次许可证变更每周报一次。理由见
    // `licenses.ts` 的 `AnomalyPeriodPolicy`。
    //
    // 这一步不新增任何 GitHub 请求：`repos.license_spdx_id` 是 `update-github-data`
    // 早就读到的值，我们只是把它记下来。
    const license = await recordAndCompareLicense(
      db,
      repo.id,
      repo.licenseSpdxId,
      now
    )

    subjects.push({
      repoId: repo.id,
      now,
      weeks,
      lastReleaseAt: repo.latestReleasePublishedAt,
      releaseIntervalDays: releaseIntervals(weeks),
      pushedAt: repo.pushedAt,
      license: license.current?.license ?? null,
      licenseObservedAt: license.current?.observedAt ?? null,
      previousLicense: license.previous?.license ?? null,
      previousLicenseObservedAt: license.previous?.observedAt ?? null,
    })
  }

  return subjects
}

/**
 * 写下一批命中。
 *
 * `ON CONFLICT DO NOTHING` 是幂等性的全部来源，键是 `(repo_id, kind, period)`。这意味着：
 *
 * - 一天跑两次不会产生两行；
 * - 一条被 dismiss 掉的异动**不会**因为第二天又命中而复活。理由在
 *   `repoAnomalies.status` 的注释里：dismiss 是人对同一周同一事实的判断，而第二天
 *   命中的是同一个事实（键里的 `period` 就是周），让它复活等于把人的判断作废。
 * - 反过来，**旧结论不会因为新数据而改写**。这正是 §5.4 红线 1 想要的，也正是它
 *   要付的代价。
 *
 * `detectedAt` 显式传 `now`：默认值是 `now()`，但一次回填要把「当时的时刻」写进去，
 * 而不是把回填的时间。
 */
export async function recordHits(
  db: Db,
  hits: ReadonlyArray<RuleHit & { repoId: string }>,
  detectedAt: Date
): Promise<number> {
  if (hits.length === 0) return 0

  const inserted = await db
    .insert(repoAnomalies)
    .values(
      hits.map((hit) => ({
        id: `${hit.repoId}:${hit.kind}:${hit.period.getTime()}`,
        repoId: hit.repoId,
        kind: hit.kind,
        severity: hit.severity,
        period: hit.period,
        detectedAt,
        title: hit.title,
        magnitude: hit.magnitude,
        metric: hit.metric,
        evidence: hit.evidence,
      }))
    )
    .onConflictDoNothing()
    .returning({ id: repoAnomalies.id })

  return inserted.length
}

/**
 * 对一批仓库跑判定并写入。
 *
 * 返回真正新增的行数，而不是命中数：两者的差就是「重跑时已经存在的那部分」，而那个
 * 差值是判断任务是否健康的信号——持续大于 0 说明幂等键坏了。
 */
export async function detectAndRecord(
  db: Db,
  repoIds: string[],
  now: Date,
  timeZone: string = APP_TIMEZONE
): Promise<number> {
  const subjects = await buildSubjects(db, repoIds, now, timeZone)
  const hits = subjects.flatMap((subject) =>
    evaluate(subject).map((hit) => ({ ...hit, repoId: subject.repoId }))
  )
  return recordHits(db, hits, now)
}

/**
 * 公开异动流：尚未被 dismiss 的行，按检测时间倒序。
 *
 * 只读 `status = 'open'`。这是「误报不再打扰读者」与「误报率仍可统计」两条要求在
 * 一个查询里的落点：被 dismiss 的行不进这里，但它们还在库里。
 */
export async function listOpenAnomalies(
  db: Db,
  options: {
    limit?: number
    since?: Date
    kinds?: AnomalyKind[]
    /** 公开流默认只报忧，不报喜。「我们也会说」那一栏反过来传。 */
    includeGood?: boolean
  } = {}
): Promise<AnomalyWithRepo[]> {
  const filters = [eq(repoAnomalies.status, "open")]
  if (options.since) filters.push(gte(repoAnomalies.detectedAt, options.since))
  if (options.kinds?.length)
    filters.push(inArray(repoAnomalies.kind, options.kinds))
  // `good` rows live in the same table as the alerts (§5.4 red line 3), so the
  // default view has to exclude them by severity rather than by kind — the kind
  // is what a reader filters on later, and a reader who asks for "anomalies"
  // wants to hear about the project that is going wrong.
  if (!options.includeGood) {
    filters.push(sql`${repoAnomalies.severity} <> 'good'`)
  }

  const rows = await db
    .select({
      id: repoAnomalies.id,
      repoId: repoAnomalies.repoId,
      kind: repoAnomalies.kind,
      severity: repoAnomalies.severity,
      period: repoAnomalies.period,
      detectedAt: repoAnomalies.detectedAt,
      title: repoAnomalies.title,
      magnitude: repoAnomalies.magnitude,
      metric: repoAnomalies.metric,
      evidence: repoAnomalies.evidence,
      status: repoAnomalies.status,
      owner: repos.owner,
      name: repos.name,
      stars: repos.stars,
    })
    .from(repoAnomalies)
    .innerJoin(repos, eq(repos.id, repoAnomalies.repoId))
    .where(and(...filters))
    // Severity, then magnitude, then recency.
    //
    // Severity first because magnitude is only comparable within a kind (§
    // repo_anomalies.magnitude), so a cross-kind ordering by it would be
    // arbitrary — and an arbitrary ordering reads as a meaningful one. Grouping
    // by severity is also what makes the feed legible: every alert above every
    // notice, regardless of units.
    //
    // `detectedAt` last as the tiebreaker so the order is total and stable —
    // without it two rows of equal magnitude shuffle between renders, and a
    // reader who scrolls back up finds the list has moved.
    .orderBy(
      // Descending on a rank where the worst band is the *highest* number, so
      // that one `desc()` can carry the whole severity ordering. `good` sits at
      // zero: it is excluded from this view by default and sorts last when a
      // caller asks for it alongside the alerts.
      desc(sql`case ${repoAnomalies.severity}
        when 'down' then 3
        when 'risk' then 2
        when 'notice' then 1
        else 0
      end`),
      desc(repoAnomalies.magnitude),
      desc(repoAnomalies.detectedAt)
    )
    .limit(options.limit ?? 50)

  return rows
}

/**
 * 一个仓库的全部异动，按周期倒序，**含已 dismiss 的**。
 *
 * 详情页的时间轴要含 dismissed 的那条，因为「这个仓库上周报过一次星标断崖，我们后来
 * 判它是误报」是读者判断今天那条结论时需要的上下文——把它藏起来等于让人重新踩一遍
 * 我们踩过的坑。
 */
export async function listRepoAnomalies(
  db: Db,
  repoId: string,
  limit = 50
): Promise<AnomalyWithRepo[]> {
  const rows = await db
    .select({
      id: repoAnomalies.id,
      repoId: repoAnomalies.repoId,
      kind: repoAnomalies.kind,
      severity: repoAnomalies.severity,
      period: repoAnomalies.period,
      detectedAt: repoAnomalies.detectedAt,
      title: repoAnomalies.title,
      magnitude: repoAnomalies.magnitude,
      metric: repoAnomalies.metric,
      evidence: repoAnomalies.evidence,
      status: repoAnomalies.status,
      // Joined even though the caller already knows which repository it asked
      // about: the timeline renders a row list that shares its component with
      // the feed, and a component that has to branch on "do I know the repo name
      // yet" is a component with two shapes.
      owner: repos.owner,
      name: repos.name,
      stars: repos.stars,
    })
    .from(repoAnomalies)
    .innerJoin(repos, eq(repos.id, repoAnomalies.repoId))
    .where(eq(repoAnomalies.repoId, repoId))
    .orderBy(desc(repoAnomalies.period))
    .limit(limit)

  return rows
}

/** 判定覆盖的仓库：不在归档仓库上跑，也跳过还没有任何周统计的。 */
export async function listDetectableRepoIds(
  db: Db,
  limit?: number
): Promise<string[]> {
  const rows = await db
    .select({ id: repos.id })
    .from(repos)
    .where(
      and(
        sql`${repos.archived} is not true`,
        sql`exists (select 1 from ${repoWeeklyStats} w where w.repo_id = ${repos.id})`
      )
    )
    .limit(limit ?? 2000)

  return rows.map((row) => row.id)
}

/** 标记一条异动为误报。没有理由的不给计数，理由见 schema 注释。 */
export async function dismissAnomaly(
  db: Db,
  input: { id: string; dismissedBy: string; reason: string; at: Date }
): Promise<boolean> {
  const rows = await db
    .update(repoAnomalies)
    .set({
      status: "dismissed",
      dismissedBy: input.dismissedBy,
      dismissedAt: input.at,
      dismissReason: input.reason,
    })
    .where(
      and(eq(repoAnomalies.id, input.id), eq(repoAnomalies.status, "open"))
    )
    .returning({ id: repoAnomalies.id })

  return rows.length > 0
}

/** 误报率：被 dismiss 的比例。§9.2 盯着这个数，所以它需要一个读法。 */
export async function falsePositiveRate(
  db: Db,
  since: Date
): Promise<{ total: number; dismissed: number; rate: number | null }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      dismissed: sql<number>`count(*) filter (where ${repoAnomalies.status} = 'dismissed')`,
    })
    .from(repoAnomalies)
    .where(gte(repoAnomalies.detectedAt, since))

  const total = Number(row?.total ?? 0)
  const dismissed = Number(row?.dismissed ?? 0)
  return {
    total,
    dismissed,
    rate: total === 0 ? null : Math.round((dismissed / total) * 1000) / 1000,
  }
}
