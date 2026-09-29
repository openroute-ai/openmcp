/**
 * The monthly ranking, as JSON, re-derived from the database.
 *
 * Counterpart to `week.json`, for the monthly period. Read-only and uncached,
 * like the weekly endpoint: whatever the database currently says is what a
 * consumer gets.
 */

import { db } from "@/db/client"
import { buildRankingsForMonth } from "@/lib/github/service/rankings"
import { resolveMonth } from "@/lib/rankings-web"
import { NextResponse } from "next/server"

/** Never cached: a live read must not serve last month's ranking as current. */
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  const resolved = resolveMonth(new URL(request.url).searchParams)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const rankings = await buildRankingsForMonth(db, resolved.value)
  return NextResponse.json(
    rankings,
    rankings.trending.length === 0 ? { status: 404 } : {}
  )
}
