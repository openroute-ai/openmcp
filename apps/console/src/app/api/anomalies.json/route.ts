/**
 * The public anomaly feed, as JSON.
 *
 * The third consumer of `repo_anomalies` after the HTML page and the landing
 * hero, and the only one an agent reads. It answers from the same function with
 * the same defaults as `/anomalies`, so the JSON and the page cannot disagree
 * about which rows are public — the alternative is two exports of the same
 * table, and they would drift the first time a filter was added to one of them.
 *
 * Read-only and anonymous, for the reason `rankings/rising-stars.json` is: an
 * endpoint with no authentication must not be able to write. Nothing here
 * touches a row.
 *
 * `severity` is echoed per row rather than flattened into a boolean, so an agent
 * can tell "this got worse" from "this changed and here is why it might matter"
 * without parsing our titles.
 *
 * `open` rows only. A dismissed row stays in the database as the denominator
 * for §9.2's false-positive rate, and leaving it out of here is exactly what
 * makes that number computable: the public feed shrinks when we are wrong, and
 * stays put when we are right.
 */

import { db } from "@/db/client"
import { ANOMALY_KINDS, type AnomalyKind } from "@/db/schema"
import { listOpenAnomalies } from "@/lib/radar/anomalies"
import { NextResponse } from "next/server"

/**
 * Never cached.
 *
 * A stale anomaly feed is worse than no feed: the reader has no way to tell a
 * project that went quiet a week ago from one that went quiet this morning, and
 * the whole claim of this page is that it reports declines early.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

/** One page's worth. An agent paging through more than this wants a database. */
const MAX_ROWS = 100

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const limitParam = Number(params.get("limit"))
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), MAX_ROWS)
      : MAX_ROWS

  // Validated against the enum rather than passed through: an unknown `kind` in
  // a query string would otherwise widen the result to "everything except",
  // which reads as a filter and behaves as an inversion.
  const kindParam = params.get("kind")
  const kind = kindParam
    ? ANOMALY_KINDS.find((candidate) => candidate === kindParam)
    : undefined
  if (kindParam && !kind) {
    return NextResponse.json(
      {
        error: `Unknown kind. One of: ${ANOMALY_KINDS.join(", ")}`,
      },
      { status: 400 }
    )
  }

  const sinceParam = params.get("since")
  const since = sinceParam ? new Date(sinceParam) : undefined
  if (sinceParam && Number.isNaN(since?.getTime())) {
    return NextResponse.json(
      { error: "`since` must be an ISO 8601 timestamp" },
      { status: 400 }
    )
  }

  const includeGood = params.get("include") === "good"

  const anomalies = await listOpenAnomalies(db, {
    limit,
    since,
    kinds: kind ? [kind as AnomalyKind] : undefined,
    includeGood,
  })

  return NextResponse.json({
    anomalies: anomalies.map((row) => ({
      id: row.id,
      repo: `${row.owner}/${row.name}`,
      owner: row.owner,
      name: row.name,
      stars: row.stars,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      magnitude: row.magnitude,
      period: row.period.toISOString(),
      detectedAt: row.detectedAt.toISOString(),
      metric: row.metric,
      evidence: row.evidence,
    })),
    count: anomalies.length,
    // The collection time, in the response rather than only in the page. §5.9.4
    // requires it be visible, and an agent fetching this has no way to see the
    // page's footer.
    generatedAt: new Date().toISOString(),
  })
}
