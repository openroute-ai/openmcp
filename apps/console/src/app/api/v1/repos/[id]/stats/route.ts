/**
 * `GET /api/v1/repos/{id}/stats` — 日 / 周 / 月三种粒度的区间统计（§4.1）。
 *
 * 两条必须知道的行为，都在响应里如实表达：
 *
 * - **不补洞。** 窗口内没有采集的那几天直接不出现，不是 0。而 `total_*` / `delta_*`
 *   的 `null` 也原样透传：`null` 的含义是「这个周期没有采集」，转成 0 就变成了
 *   「采集到 0」。这两件事都不是丢数据，是"没量过"与"量到 0"的区别。
 * - **`end` 是该仓库最新已存周期**，不 clamp 到今天。采集停了就是停了，报一个
 *   未来的空窗口只会让调用方以为自己查错了。
 *
 * 游标编码的是"上一页读到的最后一期"这一个瞬间，不是偏移量：两次请求之间会落进新
 * 一期，而调用方要的是"我读过的之后"。坏游标报 400，不退回第一页 —— 静默退回会让
 * 调用方以为数据只有一页。
 */
import { and, eq, sql } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import { repos } from "@/db/schema"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { repoStatsRangeSchema } from "@/lib/api/contract"
import { repoVisibilityCondition } from "@/lib/api/repo-filter"
import {
  decodeCursor,
  defaultRangeStart,
  encodeCursor,
  parseStatsQuery,
  statsPeriodPayload,
  toStatsCadence,
} from "@/lib/api/stats"
import { getRepoByFullName } from "@/lib/github/service/repo"
import {
  countStatsPeriods,
  latestStatsPeriod,
  listStatsRange,
  type StatsRangeQuery,
} from "@/lib/github/service/stats"
import { APP_TIMEZONE } from "@/lib/time"

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request, { scope: "repos:read" })
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const query = parseStatsQuery(url.searchParams)
  if (!query.ok) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", query.message, { detail: query.detail }),
      auth.rateLimitHeaders
    )
  }

  const { id } = await params
  const resolved = await resolveRepo(id, auth.principal.submitterId)
  if (!resolved) {
    return withRateLimitHeaders(
      apiError(404, "not_found", "仓库不存在或不可见"),
      auth.rateLimitHeaders
    )
  }

  const { cadence, limit } = query.value
  const stored = toStatsCadence(cadence)

  // 游标先解：坏游标必须报 400，不能退化成"没有游标"从头再来。
  const cursorRaw = query.value.cursor
  const before = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw)
  if (cursorRaw !== undefined && before === null) {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "cursor 不合法", {
        detail: "cursor 是上一页响应里的 nextCursor",
      }),
      auth.rateLimitHeaders
    )
  }

  // 缺省区间：`[最新已存周期 - 90d, 最新已存周期]`。显式给的 start/end 各自独立生效，
  // 所以 `?start=` 单独出现就是"从那天到最新一期"。
  const end = query.value.end ?? ((await latestStatsPeriod(db, resolved.id, stored)) ?? new Date())
  const start = query.value.start ?? defaultRangeStart(end)

  const window: StatsRangeQuery = { start, end, ...(before ? { before } : {}) }
  const [page, periods] = await Promise.all([
    listStatsRange(db, resolved.id, stored, { ...window, limit }),
    countStatsPeriods(db, resolved.id, stored, window),
  ])

  const last = page.rows[page.rows.length - 1]

  return withRateLimitHeaders(
    NextResponse.json({
      repoId: resolved.id,
      fullName: resolved.fullName,
      cadence,
      timezone: APP_TIMEZONE,
      range: { start: start.toISOString(), end: end.toISOString() },
      counts: { periods, returned: page.rows.length, hasMore: page.hasMore },
      periods: page.rows.map((row) => statsPeriodPayload(row, cadence)),
      // 游标指向**这一页最后一期**：它已经返回给调用方了，下一页要严格早于它，
      // 否则边界那一期会在两页里各出现一次。
      nextCursor: page.hasMore && last ? encodeCursor(last.period) : null,
    } satisfies z.output<typeof repoStatsRangeSchema>),
    auth.rateLimitHeaders
  )
}

/** `{id}` 可以是 nanoid，也可以是 URL 编码过的 `owner/name`。 */
async function resolveRepo(
  id: string,
  ownerUserId: string | null
): Promise<{ id: string; fullName: string } | undefined> {
  const decoded = safeDecode(id)
  const byFullName = decoded.includes("/")
    ? await getRepoByFullName(db, decoded)
    : undefined
  const repoId = byFullName?.id ?? decoded

  const [visible] = await db
    .select({ id: repos.id, fullName: sql<string>`${repos.owner} || '/' || ${repos.name}` })
    .from(repos)
    .where(and(eq(repos.id, repoId), repoVisibilityCondition(ownerUserId)))
    .limit(1)

  return visible
}

function safeDecode(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}