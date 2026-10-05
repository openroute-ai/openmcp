/**
 * The skill export endpoint.
 *
 * The console pushes each skill to its project's own destination as it is
 * synced, which is the primary path. This endpoint is the pull direction for a
 * consumer that would rather fetch a page than receive a callback: it returns
 * the same payload the webhook sends, for the same skills, so a consumer can
 * switch between the two without translating anything.
 *
 * It is also the safety net for the push direction, because the push is now
 * per-submitter: a destination that was wrong, or that was unreachable while
 * this app restarted, leaves rows queued on the submitter's side that only it
 * can resolve. `SKILLS_WEBHOOK_TOKEN` is what makes that possible — it is
 * granted per consumer rather than shared with the push path, so holding it
 * grants read access to every project's skills and no ability to push to any.
 *
 * Pagination is by cursor rather than offset, because a skill that is
 * acknowledged mid-walk must not shift the page boundary. The cursor is the
 * moment a skill was last confirmed synced, and skills never confirmed sort
 * first, so a walk with no cursor starts at the work that is actually
 * outstanding.
 *
 * Read-only on purpose. Marking a skill as exported would make the export
 * itself the thing that hides work, and the acknowledgement belongs to
 * whoever confirms delivery.
 *
 * Fails closed like the other token routes: with no `SKILLS_WEBHOOK_TOKEN` the
 * route reports 404 rather than 401.
 */

import { db } from "@/db/client"
import { authorized } from "@/lib/cron/guard"
import { syncEnv } from "@/lib/env"
import { listSkillsForExport } from "@/lib/github/service/skill"
import { buildSkillWebhookPayload } from "@/lib/webhook/skill-webhook"
import { NextResponse } from "next/server"

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** Read-through data that changes as tasks run, so it is never cached. */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const secret = syncEnv().SKILLS_WEBHOOK_TOKEN

  if (!secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const limit = readLimit(params.get("limit"))
  if (limit === null) {
    return NextResponse.json(
      { error: `limit must be an integer between 1 and ${MAX_LIMIT}` },
      { status: 400 }
    )
  }

  const cursor = readCursor(params.get("cursor"))
  if (cursor === null) {
    return NextResponse.json(
      { error: "cursor must be an ISO 8601 timestamp" },
      { status: 400 }
    )
  }

  const rows = await listSkillsForExport(db, { cursor, limit })
  const page = rows.slice(0, limit)
  const last = page.at(-1)

  return NextResponse.json({
    skills: page.map(({ skill, repo }) =>
      buildSkillWebhookPayload({
        repoOwner: repo.owner,
        repoName: repo.name,
        skillDir: skill.skillDir,
        name: skill.name,
        description: skill.description,
        descriptionZh: skill.descriptionZh,
        readme: skill.readme,
        readmeZh: skill.readmeZh,
        version: skill.version,
      })
    ),
    // The last row of a full page is not proof there is more, so the cursor
    // only advances when the extra row confirms it.
    next_cursor:
      rows.length > limit && last
        ? (last.skill.syncedToWebAt?.toISOString() ?? null)
        : null,
  })
}

function readLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT
  const limit = Number(raw)
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT
    ? limit
    : null
}

/** A missing cursor is the start of a walk; an unparseable one is an error. */
function readCursor(raw: string | null): Date | undefined | null {
  if (raw === null || raw === "") return undefined
  const cursor = new Date(raw)
  return Number.isNaN(cursor.getTime()) ? null : cursor
}
