/**
 * The Rising Stars report for a year, as JSON.
 *
 * Like the build task, this defaults to the last complete year. The report is
 * recomputed on request so the endpoint always agrees with the rows an admin
 * sees, and the projection is deterministic, so a read never changes the
 * numbers — only confirms them. Nothing is written: this route has no
 * authentication, and the sibling `week.json` / `month.json` routes are
 * documented as read-only, so an anonymous request must not be able to delete
 * and reinsert a year's rows. `buildRisingStarsForYear` is the persisting path,
 * behind the console's own rebuild button and the yearly task.
 */

import { db } from "@/db/client"
import { computeRisingStarsForYear } from "@/lib/github/service/rising-stars"
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

  const { report } = await computeRisingStarsForYear(db, resolved.value)
  return NextResponse.json(
    report,
    report.projects.length === 0 ? { status: 404 } : {}
  )
}
