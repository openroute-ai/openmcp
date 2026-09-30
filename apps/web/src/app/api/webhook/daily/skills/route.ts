/**
 * Inbound Skills webhook from apps/console (`push-skills` / export).
 *
 * Contract: POST body is `SkillWebhookPayload` (`event_type: skill_updated`).
 * Auth: `Authorization: Bearer <WEB_SKILLS_INGEST_TOKEN|SKILLS_WEBHOOK_TOKEN>`.
 * Fails closed (404) when no token is configured.
 *
 * Console side:
 *   SKILLS_WEBHOOK_URL=https://<web>/api/webhook/daily/skills
 *   SKILLS_WEBHOOK_TOKEN=<same secret>
 *
 * Optional pull (same payload shape):
 *   curl -H "Authorization: Bearer $SKILLS_WEBHOOK_TOKEN" \
 *     "$CONSOLE_URL/api/skills-sync/export?limit=100"
 */

import { type NextRequest, NextResponse } from 'next/server'
import {
  ingestConsoleSkill,
  validateSkillWebhookPayload,
} from '@/lib/skills/ingest-console-skill'
import { assertSkillsIngestAuthorized } from '@/lib/webhook/bearer-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const unauthorized = assertSkillsIngestAuthorized(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const validated = validateSkillWebhookPayload(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  try {
    const result = await ingestConsoleSkill(validated.payload.data)
    return NextResponse.json({
      ok: true,
      id: result.id,
      referenceId: result.referenceId,
      slug: result.slug,
      created: result.created,
      status: result.status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[webhook/daily/skills]', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
