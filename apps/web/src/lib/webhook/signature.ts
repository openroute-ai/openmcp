/**
 * Verifying console's signed skill deliveries.
 *
 * `apps/console` has no deployment-wide skills endpoint: the submitter states
 * its own address and signing key on `POST /api/v1/projects`, and console signs
 * each delivery with that key. So this is the receiving half of a per-submitter
 * credential, and the shared bearer is no longer the only thing standing between
 * a stranger and the ability to inject a skill document.
 *
 * The scheme is console's, unchanged: `sha256=<hex>` over `<unix-seconds>.<body>`
 * in `x-webhook-signature`, with the covered timestamp in `x-webhook-timestamp`.
 * It is duplicated here rather than imported because the two apps deliberately
 * share no runtime code — console is barred from `@workspace/db` and `@workspace/auth`,
 * and importing across the boundary is the coupling the split exists to prevent.
 * The wire contract is duplicated by hand here for the same reason the
 * `SkillWebhookData` payload type is.
 *
 * The body signed is the exact string received, never a re-serialisation: key
 * order would change and every genuine request would fail to verify.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Header carrying the Unix-seconds timestamp the signature covers. */
export const SIGNATURE_HEADER = 'x-webhook-timestamp'

/** Header carrying `sha256=<hex>`. */
export const SIGNATURE_HEADER_SIGNATURE = 'x-webhook-signature'

/**
 * How stale a signed request may be, in seconds.
 *
 * Without a bound, a receiver that only checks the HMAC will accept a captured
 * request forever — which is the whole difference between a signature and a
 * checksum. Five minutes is wide enough for clock skew between two hosts and
 * narrow enough that a leaked request log is not a standing credential.
 */
const FRESHNESS_TOLERANCE_SECONDS = 300

/**
 * `sha256=<hex>` over `<timestamp>.<body>`.
 *
 * The timestamp is included so this is a signature rather than a checksum: a
 * receiver replaying a captured request an hour later recomputes a different
 * HMAC and rejects it.
 */
export function signPayload(payload: string, timestamp: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`
}

/**
 * Verifies a signature in constant time.
 *
 * Length is checked first because `timingSafeEqual` throws on a mismatch, and
 * that check leaks nothing useful: the signature is a fixed-size digest.
 */
export function verifySignature(
  payload: string,
  timestamp: string,
  secret: string,
  received: string | null | undefined
): boolean {
  if (!received) return false

  const expected = Buffer.from(signPayload(payload, timestamp, secret))
  const actual = Buffer.from(received)
  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}

/**
 * Whether a signed request is recent enough to accept.
 *
 * Bounded on both sides: a timestamp far in the future is as suspect as one far
 * in the past, and allowing it would let a skewed clock reset the window.
 */
export function isFreshSignature(
  timestamp: string | null | undefined,
  now: Date = new Date(),
  toleranceSeconds = FRESHNESS_TOLERANCE_SECONDS
): boolean {
  if (!timestamp) return false

  const sent = /^\d+$/.test(timestamp)
    ? Number(timestamp) * 1000
    : Date.parse(timestamp)
  if (Number.isNaN(sent)) return false

  const ageSeconds = (now.getTime() - sent) / 1000
  return ageSeconds >= -toleranceSeconds && ageSeconds <= toleranceSeconds
}

/**
 * Whether a request carries an acceptable console signature.
 *
 * Both the freshness window and the HMAC have to pass. A stale-but-correctly
 * signed request is rejected by the first, and a fresh request with a wrong key
 * by the second, so neither check is redundant.
 */
export function isValidConsoleSignature(
  request: Request,
  rawBody: string,
  secret: string,
  now: Date = new Date()
): boolean {
  const timestamp = request.headers.get(SIGNATURE_HEADER)
  if (!isFreshSignature(timestamp, now)) return false
  return verifySignature(rawBody, timestamp!, secret, request.headers.get(SIGNATURE_HEADER_SIGNATURE))
}