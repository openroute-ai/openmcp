/**
 * Shared bearer gate for inbound machine-to-machine webhooks.
 *
 * Matches the console cron/export pattern: constant-time compare, and fail
 * closed with 404 (not 401) when no secret is configured so an unconfigured
 * deployment does not advertise that the route exists.
 *
 * Two credentials are accepted here, in {@link assertSkillsWebhookAuthorized}:
 * a per-submitter HMAC signature (`lib/webhook/signature.ts`) is primary, and
 * {@link skillsIngestToken} is the plain bearer alternative for a console that
 * predates per-submitter callbacks. The *pull* direction — reading console's
 * skill export — takes `CONSOLE_API_KEY` with the `skills:read` scope instead,
 * so no token resolved from this module reaches console.
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
 * The plain bearer accepted on the inbound skills push, tried only after the
 * HMAC signature. One value, one name: the export this credential used to
 * share a name with now takes `CONSOLE_API_KEY` + `skills:read`.
 */
export function skillsIngestToken(): string | undefined {
  return process.env.WEB_SKILLS_INGEST_TOKEN?.trim() || undefined
}

/**
 * The key this app hands console in `callbackSecret` when it submits a
 * repository, and therefore the key console signs the resulting skill deliveries
 * with.
 *
 * Distinct from {@link skillsIngestToken} on purpose: this one is the key console
 * *signs* with — holding it proves console authored a delivery — while that one
 * is only a bearer this route accepts as a fallback. Collapsing them would let
 * anyone who can send the fallback bearer also forge signed deliveries.
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