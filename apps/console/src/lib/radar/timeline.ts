/**
 * 证据时间轴。
 *
 * §5.4 的红线 2 说的是「每条异动必须附原始时间轴」，但落地页营销的��证据时间轴」
 * 是另一件事：它是**一个仓库的全部可核对事实按时间排成的一条线**——异动、发版、
 * 推送、许可证观测，混在一起。两者不是同一个东西，因为前者是每条异动自带的证据
 * （写在 `repo_anomalies.evidence` 里），后者要让读者看到异动**之间**发生了什么。
 *
 * 所以这一层刻意**不重新计算**任何判定。它只把已经存下来的东西按时间排列：异动
 * 读 `repo_anomalies`，许可证观测读 `repo_license_history`，发布与推送读 stats 与
 * `repos`。一个只做排版、不做判断的层，才可以在阈值改了之后仍然给出同一条时间轴
 * ——而一个顺手「顺便算一下这周算不算停滞」的时间轴，会让昨天的异动在今天消失。
 */

import { and, desc, eq, gte, lte } from "drizzle-orm"
import {
  type AnomalyKind,
  type AnomalyStatus,
  type EvidencePayload,
  type MetricPayload,
  repoLicenseHistory,
  repoWeeklyStats,
} from "@/db/schema/github"
import type { Db } from "@/lib/github/service/repo"
import { APP_TIMEZONE } from "@/lib/time"
import { weekOfPeriod } from "@/lib/github/snapshot-dates"
import { listRepoAnomalies } from "./anomalies"

const MS_PER_DAY = 86_400_000

/** 时间轴上一件事的类别。刻意用四个而不是「异动 / 非异动」两类。 */
export type TimelineEventKind = "anomaly" | "release" | "push" | "license"

/**
 * 一件事。
 *
 * 所有字段可选，因为四类事件的形状确实不同，而把它们强行压进同一个必填结构只会
 * 让读者拿到一堆 `null`。可选在这里的意思是「这类事件没有这个概念」，不是「数据
 * 缺失」。
 */
export interface TimelineEvent {
  at: Date
  kind: TimelineEventKind
  title: string
  /** 一句话补充。异动带的是它自己的结论，许可证带的是「观测而非变更」的提示。 */
  detail?: string
  /** 只有异动有：指向 `repo_anomalies.id`，供 dismiss 与跳转使用。 */
  anomalyId?: string
  /**
   * 只有异动有：**哪一种**异动。
   *
   * `kind` 说「这是一条异动」，这一项说「哪一种」。两者都要，因为前者决定它落在
   * 时间轴的哪个分组、能不能被 dismiss，后者决定它显示成什么、用什么颜色——而把
   * 后者从时间轴里丢掉会让「增速断崖」和「许可证变更」在读者眼里长得一模一样，
   * 那正是这份时间轴存在的唯一理由。
   */
  anomalyKind?: AnomalyKind
  /** 只有异动有。 */
  severity?: string
  /** 只有异动有：随事件一起渲染的原始量。 */
  metric?: MetricPayload | null
  /** 只有异动有：随事件一起渲染的证据序列。 */
  evidence?: EvidencePayload | null
  /**
   * 只有异动有。
   *
   * 之所以**保留已 dismiss 的**而不是过滤掉：时间轴是解释「今天这条结论为什么可信」
   * 的上下文，而「上周报过一次、后来判为误报」正是判断今天这条需要的信息。把它
   * 藏掉等于让读者重走我们已经走过的路。组件负责把它显示得明显不同。
   */
  status?: AnomalyStatus
}

/** 时间轴的读取范围。 */
export interface TimelineOptions {
  /** 从这个时刻起（不含）。 */
  since?: Date
  /** 最多返回多少条，按时间倒序截断。 */
  limit?: number
  /**
   * 是否包含发布与推送。
   *
   * 默认包含，因为「上次的发布是 4 个月前」是读者判断「发布停滞」那条异动时最想看
   * 的一句。但发布事件按**周**聚合计数，把它塞进天级时间轴会挤掉真正的异动，
   * 所以有 `releaseWeeks` 控制看几周。
   */
  releaseWeeks?: number
  timeZone?: string
}

/**
 * 读出一个仓库的时间轴，最新的在前。
 *
 * 三类事实分三次查询而不是一次 join：`repo_anomalies` 与
 * `repo_license_history` 按行取整，而发布是「按周聚合的计数」——它和前两者不在同
 * 一个粒度上，硬 join 出来的排序会让人以为某个发布发生在某一天，而那一天是我们
 * 不知道的。三次查询 + 一次归并，比假装它们同粒度便宜，也诚实。
 */
export async function readTimeline(
  db: Db,
  repoId: string,
  options: TimelineOptions = {}
): Promise<TimelineEvent[]> {
  const {
    since,
    limit = 40,
    releaseWeeks = 12,
    timeZone = APP_TIMEZONE,
  } = options

  const events: TimelineEvent[] = []

  for (const anomaly of await listRepoAnomalies(db, repoId, limit)) {
    if (since && anomaly.detectedAt < since) continue
    events.push({
      at: anomaly.detectedAt,
      kind: "anomaly",
      title: anomaly.title,
      detail: firstNote(anomaly.evidence),
      anomalyId: anomaly.id,
      anomalyKind: anomaly.kind,
      severity: anomaly.severity,
      metric: anomaly.metric,
      evidence: anomaly.evidence,
      status: anomaly.status,
    })
  }

  for (const observation of await db
    .select({
      license: repoLicenseHistory.license,
      observedAt: repoLicenseHistory.observedAt,
    })
    .from(repoLicenseHistory)
    .where(eq(repoLicenseHistory.repoId, repoId))
    .orderBy(desc(repoLicenseHistory.observedAt))) {
    if (since && observation.observedAt < since) continue
    events.push({
      at: observation.observedAt,
      kind: "license",
      title: `观测到许可证 ${observation.license}`,
      // 时刻意说明这不是变更时间。见 `repoLicenseHistory.observedAt` 的注释。
      detail: "观测时间，不是变更时间",
    })
  }

  const releases = await db
    .select({
      period: repoWeeklyStats.period,
      deltaReleases: repoWeeklyStats.deltaReleases,
      totalReleases: repoWeeklyStats.totalReleases,
    })
    .from(repoWeeklyStats)
    .where(eq(repoWeeklyStats.repoId, repoId))
    .orderBy(desc(repoWeeklyStats.period))
    .limit(releaseWeeks)

  for (const row of releases) {
    if ((row.deltaReleases ?? 0) <= 0) continue
    if (since && row.period < since) continue
    const { year, week } = weekOfPeriod(row.period, timeZone)
    events.push({
      at: row.period,
      kind: "release",
      // 措辞是「这一周」而不是某一天：周行的 `delta_releases` 只知道量，不知道
      // 日期，写一个具体日子就是在编。
      title: `第 ${year} 年第 ${week} 周发布 ${row.deltaReleases} 次`,
      detail:
        row.totalReleases === null
          ? undefined
          : `累计 ${row.totalReleases} 个 release`,
    })
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime())
  return events.slice(0, limit)
}

/** 取证据里第一条补充说明，作为时间轴上的单行摘要。 */
function firstNote(evidence: unknown): string | undefined {
  if (!evidence || typeof evidence !== "object") return undefined
  const notes = (evidence as EvidencePayload).notes
  return Array.isArray(notes) && typeof notes[0] === "string"
    ? notes[0]
    : undefined
}

/**
 * 「多久没有推送了」。
 *
 * 单独成一个函数而不是塞进 `readTimeline`：它是**当下**的一个读数，不是时间轴上的
 * 一个事件——`repos.pushed_at` 只有当前值，没有历史，所以它没有 `at`，也就无法排进
 * 一条按时间排的线。把它渲染成「2023 年 4 月 12 日推送过」是在暗示我们还有那之后的
 * 信息，而那句话是假的。
 */
export function daysSincePush(pushedAt: Date, now: Date = new Date()): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - pushedAt.getTime()) / MS_PER_DAY)
  )
}

/** 一个时间窗口内的周行，读给不想写 SQL 的调用方用。 */
export async function listWeeksInRange(
  db: Db,
  repoId: string,
  from: Date,
  to: Date
) {
  return db
    .select()
    .from(repoWeeklyStats)
    .where(
      and(
        eq(repoWeeklyStats.repoId, repoId),
        gte(repoWeeklyStats.period, from),
        lte(repoWeeklyStats.period, to)
      )
    )
}
