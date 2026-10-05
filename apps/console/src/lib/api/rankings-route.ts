/**
 * `GET /api/v1/rankings/weekly` 与 `/monthly` — 指定周期的排行（§5.1）。
 *
 * 榜单部分**沿用现有的 `Rankings`**（`trending` + `byRelativeGrowth`），不另立一套字段：
 * 站内榜单页、排行任务与开放 API 共用同一份形状，多一份实现就多一份会漂的副本。
 *
 * `year` / `week`（或 `month`）都不传时取**最近一个完整周期**，而 `period` 会把它回显
 * 出来。不回显的话，调用方无从知道自己拿到的到底是哪一期，而「静默地排了另一周」正是
 * 这条路要避免的。当前周期还没走完，`measurePeriod` 里没有可比的前一期，缺省取最近一个
 * **完整**周期而不是当前周期，正是为此。
 *
 * 响应带 `ETag` 与 `Cache-Control`：排行的输入是一张只增不改的统计表，同一期在数据
 * 闭合之后就不再变化，所以这一层缓存是安全的。`If-None-Match` 命中就回 304，条件请求
 * 不必重新下载整份榜单。
 */
import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { rankingsPayload, rankingsSchema } from "@/lib/api/contract"
import { buildRankingsForMonth, buildRankingsForWeek } from "@/lib/github/service/rankings"
import {
  lastCompletePeriod,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

/** 榜单自己就是 100 条的上界，`limit` 只能更小。 */
const MAX_LIMIT = 100

/**
 * 解析结果。周期与目标**绑在同一个对象**里返回，调用处才能把两者一起收窄 ——
 * 分成 `ok: true` + 一个 `YearWeek | YearMonth` 的话，TypeScript 无法知道
 * 「`period === "week"` 时 value 一定有 `week`」，而这正是这个函数要保证的事。
 */
type PeriodTarget =
  | { period: "week"; value: YearWeek }
  | { period: "month"; value: YearMonth }

type ResolveResult<T> = { ok: true; target: T } | { ok: false; error: string }

/** 排行任务算完后存进 OSS 的那一期，对条件请求是可缓存的。 */
const CACHE_CONTROL = "public, max-age=300, s-maxage=3600"

export interface RankingsRouteInput {
  period: "week" | "month"
  params: URLSearchParams
  now?: Date
}

export async function handleRankingsRequest(
  request: Request,
  input: RankingsRouteInput
): Promise<Response> {
  const scope = "rankings:read"
  const auth = await authenticateApiKey(request, { scope })
  if (!auth.ok) return auth.response

  const { period, params, now = new Date() } = input

  const limit = parseLimit(params.get("limit"))
  if (limit === null) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "limit 不合法", {
        detail: `1..${MAX_LIMIT} 的整数`,
      }),
      auth.rateLimitHeaders
    )
  }

  // `period` 跟着参数走而不是跟着端点走：解析的结果与请求的周期必须一致，
  // 而把它放进同一个对象里，TypeScript 就能在调用处把周期与年份周收窄到一起。
  const resolved = resolvePeriod(period, params, now)
  if (!resolved.ok) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", resolved.error),
      auth.rateLimitHeaders
    )
  }

  const { target } = resolved
  const rankings =
    target.period === "week"
      ? await buildRankingsForWeek(db, target.value, { limit })
      : await buildRankingsForMonth(db, target.value, { limit })

  const body = rankingsPayload(rankings)
  const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url")}"`

  // 条件请求命中就 304，body 不再发一遍 —— 榜单是本组端点里唯一大到值得这么做的。
  if (request.headers.get("if-none-match") === etag) {
    return withRateLimitHeaders(
      new Response(null, {
        status: 304,
        headers: { ETag: etag, "cache-control": CACHE_CONTROL },
      }),
      auth.rateLimitHeaders
    )
  }

  return withRateLimitHeaders(
    NextResponse.json(body satisfies z.output<typeof rankingsSchema>, {
      headers: { ETag: etag, "cache-control": CACHE_CONTROL },
    }),
    auth.rateLimitHeaders
  )
}

/**
 * 周期从哪来。
 *
 * 两个参数都不给 = 最近一个完整周期；只给 `year` 不给 `week` / `month` 同样落到最近
 * 一个完整周期，而不是"那一年的最后一周" —— 后者对 `year` 是过去的年份就完全答不出
 * 来了，而它回答的是同一个问题。
 */
function resolvePeriod(
  period: "week" | "month",
  params: URLSearchParams,
  now: Date
): ResolveResult<PeriodTarget> {
  const year = params.get("year")
  const index = params.get(period === "week" ? "week" : "month")

  // 两个参数都不给 = 最近一个完整周期。
  if (year === null && index === null) return recentComplete(period, now)

  if (year !== null && !/^\d{4}$/.test(year)) {
    return { ok: false, error: "year 必须是四位年份" }
  }
  const parsedYear = year === null ? null : Number(year)
  if (parsedYear !== null && (parsedYear < 2000 || parsedYear > 9999)) {
    return { ok: false, error: "year 必须在 2000-9999 之间" }
  }

  // 只给了 year：仍然是"最近一个完整周期"，year 用来挑哪一年的那一期。
  if (index === null) {
    if (parsedYear === null) {
      return { ok: false, error: "year 与 week/month 必须成对出现" }
    }
    // `recentComplete` 在每个分支里各调一次，而不是调一次再按 `period` 分支：
    // 前者的返回类型跟着 `period` 收窄，后者的 `value` 仍是
    // `YearWeek | YearMonth`，于是 `.week` 要靠断言才过得去。
    if (period === "week") {
      const base = lastCompletePeriod("week", now)
      return {
        ok: true,
        target: { period: "week", value: { year: parsedYear, week: base.week } },
      }
    }
    const base = lastCompletePeriod("month", now)
    return {
      ok: true,
      target: { period: "month", value: { year: parsedYear, month: base.month } },
    }
  }

  if (!/^\d{1,2}$/.test(index)) {
    return {
      ok: false,
      error: period === "week" ? "week 必须是 1-53" : "month 必须是 1-12",
    }
  }
  const number = Number(index)
  if (period === "week" && (number < 1 || number > 53)) {
    return { ok: false, error: "week 必须是 1-53" }
  }
  if (period === "month" && (number < 1 || number > 12)) {
    return { ok: false, error: "month 必须是 1-12" }
  }
  // 周期序号单独出现时无处安放：同一个周号在 2025 和 2026 指的是不同的两周，
  // 猜一个年份会让调用方拿到另一期数据而不是一个错误。
  if (parsedYear === null) {
    return { ok: false, error: "year 与 week/month 必须成对出现" }
  }

  return period === "week"
    ? { ok: true, target: { period: "week", value: { year: parsedYear, week: number } } }
    : { ok: true, target: { period: "month", value: { year: parsedYear, month: number } } }
}

/** 最近一个完整周期，按周期分开调用以便类型收窄。 */
function recentComplete(
  period: "week" | "month",
  now: Date
): ResolveResult<PeriodTarget> {
  return period === "week"
    ? { ok: true, target: { period: "week", value: lastCompletePeriod("week", now) } }
    : { ok: true, target: { period: "month", value: lastCompletePeriod("month", now) } }
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return MAX_LIMIT
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1 && value <= MAX_LIMIT ? value : null
}