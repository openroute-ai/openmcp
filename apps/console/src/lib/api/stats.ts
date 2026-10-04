/**
 * 统计端点的粒度、游标与序列化。
 *
 * 这一层做三件 HTTP 才需要的事，业务层都不知道：
 *
 * 1. **粒度改名**。表里的 `StatsCadence` 是 `day | week | month`（按周期开的那一瞬间
 *    建的），而线上契约是 `daily | weekly | monthly`。映射放在这里而不是路由里，
 *    是因为排行与统计两条线都读它 —— 漏一次映射就是一个查空表的端点。
 * 2. **游标编解码**。游标是"上一页最后读到的期"这一个瞬间，base64 之后看起来像个
 *    不透明的串。游标必须校验：一个坏游标如果被当成"没有游标"，就会静默地退回
 *    第一页，调用方会以为数据只有一页。
 * 3. **一行行的形状**。三个周期标签恒定输出、不适用的为 `null`（§4.1），所以客户端
 *    不必按 `cadence` 分支解析；`total_*` / `delta_*` 的 `null` 原样透传。
 */
import { z } from "zod"
import { monthOfPeriod, weekOfPeriod, type StatsCadence } from "@/lib/github/snapshot-dates"
import type { StatsCounterRow } from "@/lib/github/service/stats"
import { APP_TIMEZONE, civilOf } from "@/lib/time"

/** 契约里的三种粒度。 */
export const STATS_CADENCES = ["daily", "weekly", "monthly"] as const

export type StatsCadenceParam = (typeof STATS_CADENCES)[number]

/**
 * 契约粒度 → 表的粒度。
 *
 * 一个显式的表，而不是 `cadence.slice(0, -2)` 那类小把戏：`daily → day`、
 * `weekly → week`、`monthly → month` 三条里恰好有一条不是简单截断，写成模式匹配
 * 只会骗过读代码的人，而漏掉一条的代价是这个端点返回空数组。
 */
const TO_STATS_CADENCE: Record<StatsCadenceParam, StatsCadence> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
}

/** 反向映射，投递任务按订阅的 cadence 取数据时用。 */
const FROM_STATS_CADENCE: Record<StatsCadence, StatsCadenceParam> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
}

export function toStatsCadence(cadence: StatsCadenceParam): StatsCadence {
  return TO_STATS_CADENCE[cadence]
}

export function fromStatsCadence(cadence: StatsCadence): StatsCadenceParam {
  return FROM_STATS_CADENCE[cadence]
}

/** 一天的默认回看窗口，与 OpenAPI 里写的 "默认最近 90 天" 同一个数。 */
export const DEFAULT_RANGE_DAYS = 90

const RANGE_LIMIT = { min: 1, max: 1000, default: 500 } as const

const querySchema = z.object({
  cadence: z.enum(STATS_CADENCES).default("daily"),
  start: z.iso.datetime().optional(),
  end: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(RANGE_LIMIT.min).max(RANGE_LIMIT.max).default(RANGE_LIMIT.default),
  cursor: z.string().min(1).optional(),
})

export type StatsQuery = z.output<typeof querySchema>

/** 解析失败时 caller 报 400 并带上第一个问题的位置。 */
export function parseStatsQuery(params: URLSearchParams) {
  const parsed = querySchema.safeParse(Object.fromEntries(params))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false as const,
      message: "查询参数不合法",
      detail: issue
        ? `${issue.path.join(".") || "(query)"}: ${issue.message}`
        : undefined,
    }
  }
  return { ok: true as const, value: parsed.data }
}

/**
 * 游标就是"上一页读到哪一期"，编码成 base64 让它看起来不透明。
 *
 * 编码的是 ISO 字符串而不是偏移量：偏移量在两次请求之间会因为新一期落库而指向
 * 不同的期，而调用方要的是"我读过的最后一期之后"，那个瞬间才是稳定的答案。
 */
export function encodeCursor(period: Date): string {
  return Buffer.from(period.toISOString(), "utf8").toString("base64url")
}

/** 坏游标返回 null，由调用方报 400 —— 绝不退回第一页。 */
export function decodeCursor(cursor: string): Date | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8")
    const parsed = new Date(decoded)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  } catch {
    return null
  }
}

/** 一行统计 → 契约里那一期。 */
export function statsPeriodPayload(
  row: StatsCounterRow,
  cadence: StatsCadenceParam
) {
  const stored = toStatsCadence(cadence)
  const civil = civilOf(row.period, APP_TIMEZONE)

  // 三个标签恒定输出，不适用的为 null：客户端按 cadence 分支解析就得维护三份代码，
  // 而漏分支的那一份会在周期切换时炸掉。
  const isoWeek = stored === "week" ? weekOfPeriod(row.period) : null
  const yearMonth = stored === "month" ? monthOfPeriod(row.period) : null

  return {
    period: row.period.toISOString(),
    date: stored === "day" ? `${civil.year}-${pad(civil.month)}-${pad(civil.day)}` : null,
    yearWeek: isoWeek ? `${isoWeek.year}-W${pad(isoWeek.week)}` : null,
    yearMonth: yearMonth ? `${yearMonth.year}-${pad(yearMonth.month)}` : null,
    // 原样透传：null 是"这个周期没量过"，转成 0 就是一个假的"量到 0"。
    totalStars: numberOrNull(row.totalStars),
    deltaStars: numberOrNull(row.deltaStars),
    deltaNewStars: numberOrNull(row.deltaNewStars),
    totalWatchers: numberOrNull(row.totalWatchers),
    deltaWatchers: numberOrNull(row.deltaWatchers),
    totalForks: numberOrNull(row.totalForks),
    deltaForks: numberOrNull(row.deltaForks),
    totalOpenIssues: numberOrNull(row.totalOpenIssues),
    deltaOpenIssues: numberOrNull(row.deltaOpenIssues),
    totalPullRequests: numberOrNull(row.totalPullRequests),
    deltaPullRequests: numberOrNull(row.deltaPullRequests),
    totalReleases: numberOrNull(row.totalReleases),
    deltaReleases: numberOrNull(row.deltaReleases),
    totalContributors: numberOrNull(row.totalContributors),
    deltaContributors: numberOrNull(row.deltaContributors),
    totalCommits: numberOrNull(row.totalCommits),
    deltaCommits: numberOrNull(row.deltaCommits),
    totalDownloads: numberOrNull(row.totalDownloads),
    deltaDownloads: numberOrNull(row.deltaDownloads),
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** 缺省窗口：`end - 90d`。`end` 由调用方按"最新已存周期"补上。 */
export function defaultRangeStart(end: Date): Date {
  return new Date(end.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
}