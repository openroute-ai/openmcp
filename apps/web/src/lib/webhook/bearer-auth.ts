/**
 * Shared bearer gate for inbound machine-to-machine webhooks.
 *
 * Matches the console cron/export pattern: constant-time compare, and fail
 * closed with 404 (not 401) when no secret is configured so an unconfigured
 * deployment does not advertise that the route exists.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

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

/** null = authorized; otherwise a ready-to-return NextResponse. */
export function assertSkillsIngestAuthorized(request: Request): NextResponse | null {
  const secret = skillsIngestToken()
  if (!secret) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}
