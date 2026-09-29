/**
 * The Rising Stars report for a year, as JSON.
 *
 * Like the build task, this defaults to the last complete year. The report is
 * recomputed and re-persisted on request so the endpoint always agrees with
 * the rows an admin sees; the projection is deterministic, so a read never
 * changes the numbers, only confirms them.
 */

import { db } from "@/db/client"
import { buildRisingStarsForYear } from "@/lib/github/service/rising-stars"
import { resolveYear } from "@/lib/rankings-web"
import { NextResponse } from "next/server"

/** Never cached: a freshly requested report must reflect current data. */
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  const resolved = resolveYear(new URL(request.url).searchParams)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const report = await buildRisingStarsForYear(db, resolved.value)
  return NextResponse.json(
    report,
    report.projects.length === 0 ? { status: 404 } : {}
  )
}
