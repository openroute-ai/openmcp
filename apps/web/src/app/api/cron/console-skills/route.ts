/**
 * Pull synced skill documents from `apps/console`.
 *
 * console pushes each skill to this app's `/api/webhook/daily/skills` as it is
 * synced, and that push is the primary path. This route is the safety net: a
 * push that was rejected, dropped or fired while this app was restarting leaves
 * console believing the skill was delivered, and only a walk of its export can
 * tell the difference. The export is deliberately read-only on console's side -
 * it never marks anything as exported - so re-running this is always safe.
 *
 * Both endpoints carry the same payload, so a skill can arrive either way
 * without being translated.
 *
 * It runs in two phases. The walk writes rows only, because firing a security
 * scan per skill while paging would put a hundred LLM calls in flight at once.
 * The scans then run afterwards, bounded, so a skill repaired by this route
 * lands in the same state the webhook would have left it in - not stuck in
 * `scanning` forever. Skipping them would let an un-scanned listing exist,
 * which is exactly what the review queue exists to prevent.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (see `@/lib/cron/authorize`).
 *
 * Env:
 *   CONSOLE_API_BASE_URL - console's public origin; `GITHUB_NEXTJS_API_BASE_URL`
 *     is accepted as the pre-rename name.
 *   SKILLS_WEBHOOK_TOKEN - bearer for `GET /api/skills-sync/export`. Must match
 *     console's `SKILLS_WEBHOOK_TOKEN`.
 *   CRON_SECRET - required outside development.
 */

import { NextResponse } from 'next/server'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import {
  ConsoleApiError,
  consoleSkillsExportConfigured,
  fetchConsoleSkills,
} from '@/lib/console/client'
import { filesFromSkillRow, runSkillSecurityScan } from '@/lib/security-scan'
import { db } from '@/lib/db'
import { skills } from '@workspace/db'
import { eq } from 'drizzle-orm'
import { ingestConsoleSkill, type SkillWebhookData } from '@/lib/skills/ingest-console-skill'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** console caps a page at 500; a smaller page keeps the memory spike down. */
const PAGE_SIZE = 100

/**
 * Hard stop on the walk.
 *
 * The cursor only advances for a skill console confirmed synced, so a page can
 * repeat itself if a skill is acknowledged mid-walk. Without a cap that is a
 * loop, and this route is invoked by a scheduler.
 */
const MAX_PAGES = 20

/** Scans are LLM calls, so they are run a few at a time rather than all at once. */
const SCAN_CONCURRENCY = 2

export async function GET(request: Request) {
  const unauthorized = assertCronAuthorized(request)
  if (unauthorized) return unauthorized

  // console fails closed with 404 when its token is unset, so an unconfigured
  // side is reported as skipped rather than as a failure worth alerting on.
  if (!consoleSkillsExportConfigured()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'console skills export is not configured',
    })
  }

  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') ?? PAGE_SIZE)
  const limit = Number.isInteger(limitParam) && limitParam >= 1 && limitParam <= 500 ? limitParam : PAGE_SIZE

  let cursor: string | undefined
  let pages = 0
  let ingested = 0
  let created = 0
  const repaired: string[] = []
  const failures: Array<{ reference: string; error: string }> = []

  try {
    while (pages < MAX_PAGES) {
      const page = await fetchConsoleSkills({ limit, cursor })
      pages += 1

      for (const skill of page.skills as SkillWebhookData[]) {
        try {
          const result = await ingestConsoleSkill(skill, { skipAsyncScan: true })
          ingested += 1
          repaired.push(result.id)
          if (result.created) created += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error('[cron/console-skills] ingest failed', skill?.repo_full_name, skill?.skill_dir, message)
          failures.push({ reference: `${skill?.repo_full_name}#${skill?.skill_dir}`, error: message })
        }
      }

      if (!page.next_cursor) break
      // Guards against a cursor console keeps reissuing: an empty page means
      // the walk cannot make progress.
      if (page.skills.length === 0) break
      cursor = page.next_cursor
    }

    const scanned = await scanRepaired(repaired, failures)

    return NextResponse.json({
      success: true,
      pages,
      ingested,
      created,
      scanned,
      truncated: pages === MAX_PAGES,
      failures: failures.slice(0, 20),
      failureCount: failures.length,
    })
  } catch (error) {
    if (error instanceof ConsoleApiError && error.notConfigured) {
      return NextResponse.json({ success: true, skipped: true, reason: error.message })
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron/console-skills]', message, error)
    return NextResponse.json({ success: false, error: message, pages, ingested }, { status: 502 })
  }
}

/**
 * Apply the publish policy to everything the walk touched.
 *
 * A scan failure is recorded and the walk continues: one unreadable skill must
 * not abandon the rest, and the next run will pick the same skill up again.
 */
async function scanRepaired(
  ids: string[],
  failures: Array<{ reference: string; error: string }>
): Promise<{ attempted: number; failed: number }> {
  let attempted = 0
  let failed = 0
  const queue = [...ids]

  const worker = async () => {
    for (;;) {
      const id = queue.shift()
      if (!id) return
      attempted += 1
      try {
        const [row] = await db.select().from(skills).where(eq(skills.id, id)).limit(1)
        if (!row) continue
        await runSkillSecurityScan({
          skillId: id,
          files: await filesFromSkillRow(row),
          context: {},
        })
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        console.error('[cron/console-skills] scan failed', id, message)
        failures.push({ reference: id, error: message })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, ids.length) }, () => worker())
  )

  return { attempted, failed }
}