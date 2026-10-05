/**
 * Shared bearer gate for inbound machine-to-machine webhooks.
 *
 * Matches the console cron/export pattern: constant-time compare, and fail
 * closed with 404 (not 401) when no secret is configured so an unconfigured
 * deployment does not advertise that the route exists.
 *
 * This is the **pull** direction's credential — it authorises
 * `GET /api/skills-sync/export` against console, and it is what a bare bearer on
 * the inbound skills webhook is checked against. The push direction carries a
 * per-submitter HMAC instead; see `lib/webhook/signature.ts` and
 * {@link assertSkillsWebhookAuthorized}.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isValidConsoleSignature } from '@/lib/webhook/signature'

export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const given = Buffer.from(header)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false
  return timingSafeEqual(given, wanted)
}

/**
 * Resolve the shared secret for console → web skills ingest.
 * Prefer WEB_SKILLS_INGEST_TOKEN; fall back to SKILLS_WEBHOOK_TOKEN so both
 * sides can share one value without inventing a second name.
 */
export function skillsIngestToken(): string | undefined {
  const preferred = process.env.WEB_SKILLS_INGEST_TOKEN?.trim()
  if (preferred) return preferred
  const shared = process.env.SKILLS_WEBHOOK_TOKEN?.trim()
  return shared || undefined
}

/**
 * The key this app hands console in `callbackSecret` when it submits a
 * repository, and therefore the key console signs the resulting skill deliveries
 * with.
 *
 * Distinct from {@link skillsIngestToken} on purpose: this one authorises console
 * to push *to this app*, that one authorises *from* this app to read console's
 * export. One shared value would let a holder of the export token also forge
 * skill documents.
 */
export function skillsCallbackSecret(): string | undefined {
  return process.env.CONSOLE_SKILLS_CALLBACK_SECRET?.trim() || undefined
}

/**
 * Gate for the inbound skills push from console.
 *
 * A signature is the primary credential because that is what console sends now:
 * the destination and its key are per-submitter, carried on the
 * `POST /api/v1/projects` call that registered the repository. The bearer is
 * still accepted so a console that predates per-submitter callbacks keeps
 * working, and so a hand-run `curl` with the export token can exercise the
 * route.
 *
 * Fails closed with 404 when neither credential is configured, matching the rest
 * of the machine-to-machine surface: an unconfigured deployment should not
 * advertise that the route exists at all.
 *
 * `rawBody` is the request text as received, because the signature covers those
 * exact bytes.
 */
export function assertSkillsWebhookAuthorized(
  request: Request,
  rawBody: string
): NextResponse | null {
  const callbackSecret = skillsCallbackSecret()
  const ingestToken = skillsIngestToken()

  if (!callbackSecret && !ingestToken) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  if (callbackSecret && isValidConsoleSignature(request, rawBody, callbackSecret)) {
    return null
  }

  if (ingestToken && bearerMatches(request.headers.get('authorization'), ingestToken)) {
    return null
  }

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}