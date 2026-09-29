/**
 * The machine-to-machine repository ingest endpoint.
 *
 * An external collector that already holds GitHub data can push a repository
 * here instead of making this app re-query the API for it. The body is a
 * `RepoInfo` exactly as `fetchRepoInfo` builds one, so `upsertRepo` applies
 * the same rules it applies to its own refreshes: a new row for an unknown
 * repository, and a partial update for a known one that leaves the fields
 * other tasks own — the README, its translation, the icon and the OSS image
 * URLs — untouched.
 *
 * Fails closed like the Cron and webhook routes: with no `CONSOLE_API_TOKEN`
 * the route reports 404 rather than 401, so an unconfigured instance does not
 * confirm that an unauthenticated write endpoint exists.
 */

import { db } from "@/db/client"
import { apiToken } from "@/lib/env"
import { authorized } from "@/lib/cron/guard"
import { parseRepoInfo } from "@/lib/github/repo-info-payload"
import { upsertRepo } from "@/lib/github/service/repo"
import { NextResponse } from "next/server"

/** Writes on every call, so nothing here may be served from a cache. */
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const token = apiToken()

  if (!token) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  if (!authorized(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "body is not valid JSON" },
      { status: 400 }
    )
  }

  const parsed = parseRepoInfo(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 })
  }

  const repo = await upsertRepo(db, parsed.info)

  return NextResponse.json({
    ok: true,
    // Stored as two columns, so the full name is reassembled here rather than
    // read from a column that does not exist.
    repo: {
      id: repo.id,
      full_name: `${repo.owner}/${repo.name}`,
      stars: repo.stars,
    },
  })
}
