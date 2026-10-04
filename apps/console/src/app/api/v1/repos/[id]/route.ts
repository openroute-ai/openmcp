/**
 * `GET /api/v1/repos/{id}` — 单个仓库的档案，加上最近一期的日 / 周 / 月统计。
 *
 * **`{id}` 接受两种写法**（§4.1）：`repos.id`（nanoid）或 `owner/name`。后者要 URL
 * 编码成 `owner%2Fname` —— 不编码的话斜杠会被当成路径分隔符，请求根本到不了这里。
 *
 * `latestStats` 取的是**已经存下来的最后一期**，不是昨天：采集任务随时可能停，按日历
 * 今天取会返回一串「最后有数据的那天 → 今天」的空洞，而空洞在图上和「这几天真的没人
 * star」无法区分。三个粒度各取各的：仓库可能有月数据而没有日数据，这时候日那一栏是
 * `null` 而不是被月数据顶上。
 *
 * 可见性与列表一致：公开可见，或这把 key 自己提交的。不可见时报 404 而不是 403 ——
 * 「存在但你看不到」与「不存在」对调用方是同一个答案。
 */
import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import { repos } from "@/db/schema"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { repoDetailSchema } from "@/lib/api/contract"
import { repoVisibilityCondition } from "@/lib/api/repo-filter"
import { getRepoProfile } from "@/lib/api/repo-payload"
import {
  STATS_CADENCES,
  statsPeriodPayload,
  type StatsCadenceParam,
} from "@/lib/api/stats"
import { getRepoByFullName } from "@/lib/github/service/repo"
import { listStatsRange } from "@/lib/github/service/stats"
import type { StatsCadence } from "@/lib/github/snapshot-dates"

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request, { scope: "repos:read" })
  if (!auth.ok) return auth.response

  const { id } = await params
  const ownerUserId = auth.principal.submitterId

  const repo = await resolveVisibleRepo(id, ownerUserId)
  if (!repo) return notFound(auth.rateLimitHeaders)

  const profile = await getRepoProfile(db, repo)
  if (!profile) return notFound(auth.rateLimitHeaders)

  const latestStats = Object.fromEntries(
    await Promise.all(
      STATS_CADENCES.map(async (cadence) => [
        cadence,
        await latestStatsPayload(repo, cadence),
      ] as const)
    )
  ) as z.output<typeof repoDetailSchema>["latestStats"]

  return withRateLimitHeaders(
    NextResponse.json({ repo: profile, latestStats } satisfies z.output<typeof repoDetailSchema>),
    auth.rateLimitHeaders
  )
}

function notFound(headers: Record<string, string>): Response {
  return withRateLimitHeaders(
    apiError(404, "not_found", "仓库不存在或不可见"),
    headers
  )
}

/** `daily` / `weekly` / `monthly` → 表里的 `day` / `week` / `month`。 */
const TO_STORED: Record<StatsCadenceParam, StatsCadence> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
}

/**
 * 最近一期，也就是 `limit: 1` 的倒序窗口。
 *
 * 走同一个读取函数而不是另写一个 "latest" 查询，是为了让「最近一期」与「区间里的
 * 最后一期」不可能对不上：两条查询的边界条件一旦不同步，同一个仓库在详情页和统计页
 * 上会显示不同的最后一期。
 */
async function latestStatsPayload(repoId: string, cadence: StatsCadenceParam) {
  const { rows } = await listStatsRange(db, repoId, TO_STORED[cadence], {
    limit: 1,
  })
  const row = rows[0]
  return row ? statsPeriodPayload(row, cadence) : null
}

/**
 * 把 `{id}` 变成一个 `repos` 行，并且**顺手做完可见性判定**。
 *
 * 可见性在同一次查询里判，而不是先取出来再判：后者会把一个不可见的仓库完整读进内存
 * 才丢掉，而 404 的本意就是不承认它存在。
 */
async function resolveVisibleRepo(
  id: string,
  ownerUserId: string | null
): Promise<string | undefined> {
  const decoded = safeDecode(id)
  // `owner/name` 与 nanoid 靠斜杠区分，不靠长度：nanoid 的长度不保证，将来换了
  // 长度也不会让某个仓库的 id 突然被当成 `owner/name`。
  const byFullName = decoded.includes("/")
    ? await getRepoByFullName(db, decoded)
    : undefined
  const repoId = byFullName?.id ?? decoded

  const [visible] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoId), repoVisibilityCondition(ownerUserId)))
    .limit(1)

  return visible?.id
}

/** `%2F` 在部分代理上会被提前解码成 `/`，所以两种都要试。 */
function safeDecode(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}