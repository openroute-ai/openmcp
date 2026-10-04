/**
 * `GET /api/v1/rankings/periods` — 有数据的周期目录（§5.2）。
 *
 * 先列目录、再逐期取排行，就不必猜哪些期存在。**只列有数据的期**：列出一个没有行的
 * 周，等于把客户端送去拿一个必然 404 的请求，而 404 在鉴权失败的语义里是"路由或资源
 * 不存在"——调用方会以为自己的 key 有问题。
 *
 * 两种读法共用一组参数：
 *
 * - 给了 `year`：返回该年**有数据**的期，升序；
 * - 不给 `year`：倒序返回最近若干期（默认 120）。
 *
 * 升序 / 倒序的差别不是随意的：给了年份是在翻一段历史，要按时间正着读；不给是在
 * "最近发生了什么"，要倒着读，从最新那期开始。
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { periodCatalogSchema } from "@/lib/api/contract"
import {
  listMonthlyPeriods,
  listWeeklyPeriods,
} from "@/lib/github/service/available-periods"

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

const DEFAULT_LIMIT = 120

/** 一年最多 53 期，所以按年份收窄时的读取上界用这个就够。 */
const YEAR_SCAN_LIMIT = 1000

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request, {
    scope: "rankings:read",
  })
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams

  const cadence = params.get("cadence") ?? "weekly"
  if (cadence !== "weekly" && cadence !== "monthly") {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "cadence 必须是 weekly 或 monthly"),
      auth.rateLimitHeaders
    )
  }

  const limit = parseLimit(params.get("limit"))
  if (limit === null) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "limit 不合法", {
        detail: "正整数",
      }),
      auth.rateLimitHeaders
    )
  }

  const year = parseYear(params.get("year"))
  if (year === null) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "year 必须是四位年份"),
      auth.rateLimitHeaders
    )
  }

  // 给了年份就用年份收窄，否则取最近 N 期。两条路都走同一个读取函数，
  // 所以「列出来的期」与「取得到的期」不会对不上。
  //
  // 收窄年份时要多读一些再本地过滤：一年最多 53 周、12 个月，而读取函数只支持
  // "最近 N 期"这一个方向，用 1000 当上界足够覆盖任何一年，也不用给那个函数再开
  // 一个按年查询的口子。
  const scan = year === null ? limit : YEAR_SCAN_LIMIT

  // 排序方向由「有没有给年份」决定，而不是恒定升序：
  //
  // - 给了年份：升序。在翻一段历史，要按时间正着读。
  // - 不给年份：倒序。在问「最近发生了什么」，从最新那期开始。
  //
  // 两条路都**先按年再按周/月**比，因为不给年份时窗口会跨年：只比 `week` 会把
  // 第 52 周排到第 3 周前面，而它们根本不是同一年的周。
  const direction = year === null ? -1 : 1
  const byYearThen = <T extends { year: number }>(key: (period: T) => number) =>
    (a: T, b: T) =>
      direction * (a.year - b.year || key(a) - key(b))

  let body: z.output<typeof periodCatalogSchema>
  if (cadence === "weekly") {
    const weeks = await listWeeklyPeriods(db, scan)
    body = {
      cadence,
      periods: weeks
        .filter((period) => year === null || period.year === year)
        .sort(byYearThen((period) => period.week))
        .map((period) => ({ year: period.year, week: period.week })),
    }
  } else {
    const months = await listMonthlyPeriods(db, scan)
    body = {
      cadence,
      periods: months
        .filter((period) => year === null || period.year === year)
        .sort(byYearThen((period) => period.month))
        .map((period) => ({ year: period.year, month: period.month })),
    }
  }

  return withRateLimitHeaders(
    NextResponse.json(body),
    auth.rateLimitHeaders
  )
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1 ? value : null
}

function parseYear(raw: string | null): number | null {
  if (raw === null) return null
  if (!/^\d{4}$/.test(raw)) return null
  const value = Number(raw)
  return value >= 2000 && value <= 9999 ? value : null
}