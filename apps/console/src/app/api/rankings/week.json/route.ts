/**
 * The weekly ranking, as JSON, re-derived from the database.
 *
 * The build task publishes a file a consumer enumerates; this endpoint gives
 * the same data on demand without storage. Data is served fresh because a
 * ranking that went stale would read as reality to whoever consumed it.
 */

import { db } from "@/db/client"
import { buildRankingsForWeek } from "@/lib/github/service/rankings"
import { resolveWeek } from "@/lib/rankings-web"
import { NextResponse } from "next/server"

/** Never cached: a live read must not serve yesterday's ranking as today's. */
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  const resolved = resolveWeek(new URL(request.url).searchParams)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const rankings = await buildRankingsForWeek(db, resolved.value)
  return NextResponse.json(
    rankings,
    rankings.trending.length === 0 ? { status: 404 } : {}
  )
}
