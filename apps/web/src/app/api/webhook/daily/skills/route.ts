/**
 * Inbound Skills webhook from apps/console.
 *
 * Contract: POST body is `SkillWebhookPayload` (`event_type: skill_updated`).
 *
 * Auth, in the order it is tried:
 *   1. console's HMAC signature, over `<timestamp>.<body>`, with
 *      `CONSOLE_SKILLS_CALLBACK_SECRET`. This is what it sends now: the
 *      destination and its key are per-submitter and travel on the
 *      `POST /api/v1/projects` call that registered the repository, because
 *      console has no deployment-wide skills endpoint.
 *   2. a plain bearer matching `WEB_SKILLS_INGEST_TOKEN|SKILLS_WEBHOOK_TOKEN`, so
 *      a console that predates per-submitter callbacks still works.
 *
 * Fails closed with 404 when neither credential is configured.
 *
 * Console side, when it registers a repository through the API:
 *   callbackUrl=https://<this-host>/api/webhook/daily/skills
 *   callbackSecret=<CONSOLE_SKILLS_CALLBACK_SECRET>
 *
 * Optional pull (same payload shape), which authorises the other direction —
 * this app reading console's export with `SKILLS_WEBHOOK_TOKEN`:
 *   curl -H "Authorization: Bearer $SKILLS_WEBHOOK_TOKEN" \
 *     "$CONSOLE_URL/api/skills-sync/export?limit=100"
 */

import { type NextRequest, NextResponse } from 'next/server'
import {
  ingestConsoleSkill,
  validateSkillWebhookPayload,
} from '@/lib/skills/ingest-console-skill'
import { assertSkillsWebhookAuthorized } from '@/lib/webhook/bearer-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Read once as text: the signature covers these exact bytes, so verifying it
  // against a re-serialised object would reject every genuine request.
  const rawBody = await request.text()

  const unauthorized = assertSkillsWebhookAuthorized(request, rawBody)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = JSON.parse(rawBody)
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
