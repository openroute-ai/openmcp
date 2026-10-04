/**
 * Signed outbound webhooks.
 *
 * The source app sent the shared token straight back in an
 * `x-webhook-signature` header, which authenticates nothing: anyone who can
 * read a log line or a proxy trace learns the credential, and a receiver has
 * no way to tell a genuine request from one that carries the token. This
 * signs the body instead.
 *
 * The signature covers the timestamp as well as the body, which is what makes
 * it a signature rather than a checksum. A receiver that replays a captured
 * request an hour later recomputes a different HMAC and rejects it, so a
 * leaked request log is not a standing credential.
 *
 * The token-based webhooks are kept alongside the signed ones. Those receivers
 * predate the signing change and only check a bearer token, so a signature
 * header on its own would be ignored by them.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

/** Header carrying the Unix-seconds timestamp the signature covers. */
export const SIGNATURE_HEADER = "x-webhook-timestamp"

/** Header carrying `sha256=<hex>`. */
export const SIGNATURE_SECRET_HEADER = "x-webhook-signature"

/** Header carrying the plain token, for receivers that predate signing. */
export const TOKEN_HEADER = "authorization"

/**
 * Header carrying the idempotency key (design doc §3.5).
 *
 * Unchanged across retries of one delivery, which is the whole point: a receiver
 * dedupes on it, so a value that changed per attempt would turn every retry
 * into a duplicate row.
 */
export const ID_HEADER = "x-webhook-id"

/** Header carrying the event name, so a receiver can route without parsing the body. */
export const EVENT_HEADER = "x-webhook-event"

export interface WebhookResult {
  url: string
  success: boolean
  status?: number
  error?: string
}

export interface SendOptions {
  /**
   * Signs the body. Omit for the token-based webhooks, whose receivers do not
   * verify one.
   */
  secret?: string
  /** Sent as a bearer token, for the receivers that expect one. */
  token?: string
  /** Defaults to 10s. A slow receiver must not hold a task's lock open. */
  timeoutMs?: number
  /** Injected in tests. */
  fetchImpl?: typeof fetch
  /** Injected so a replay window can be tested without waiting. */
  now?: () => Date
  /**
   * {@link ID_HEADER}. Retries must reuse the value, so it belongs to the
   * caller's payload rather than being derived here.
   */
  eventId?: string
  /** {@link EVENT_HEADER}. */
  event?: string
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * `sha256=<hex>` over `<timestamp>.<body>`.
 *
 * The body is the exact string sent, not a re-serialisation. Re-serialising
 * would change key order and break verification for any receiver that parses
 * and re-emits the JSON, so the signed bytes have to be the transmitted bytes.
 */
export function signPayload(
  payload: string,
  timestamp: string,
  secret: string
): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex")}`
}

/**
 * Verifies a signature in constant time.
 *
 * Compared with `timingSafeEqual`, so a receiver cannot be walked one byte at a
 * time to recover the expected signature. The lengths are compared first
 * because `timingSafeEqual` throws on a mismatch, and a length check leaks
 * nothing useful: the signature is a fixed-size digest.
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
 * Parses the timestamp header, which is Unix seconds.
 *
 * Unix seconds rather than ISO-8601 because that is what `signPayload` is fed,
 * and the two have to agree: a receiver verifying a signature against one
 * interpretation of the header while this module signed another would reject
 * every genuine request. `Date.parse` is the fallback for a receiver that
 * forwards the value as an ISO string instead of passing the header through.
 */
export function parseTimestamp(timestamp: string): number | undefined {
  if (/^\d+$/.test(timestamp)) {
    const seconds = Number(timestamp)
    // Guard against a bare second count being read as milliseconds: `Date`
    // treats a ~1.8e12 number as a year in the far future, which would make
    // every freshness check pass.
    return seconds * 1000
  }

  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Whether a signed request is fresh enough to accept.
 *
 * A receiver that only checks the HMAC will accept a captured request
 * forever, so the timestamp has to be bounded for the signature to be worth
 * anything.
 */
export function isFreshTimestamp(
  timestamp: string,
  now: Date,
  toleranceSeconds = 300
): boolean {
  const sent = parseTimestamp(timestamp)
  if (sent === undefined) return false

  // Not `Math.abs`: a timestamp far in the future is as suspect as one far in
  // the past, and allowing it would let a clock-skewed request reset the window.
  const ageSeconds = (now.getTime() - sent) / 1000
  return ageSeconds >= -toleranceSeconds && ageSeconds <= toleranceSeconds
}

/**
 * Posts to every configured endpoint and reports each one separately.
 *
 * `Promise.allSettled` rather than `all`: one dead mirror must not stop the
 * others from receiving the data, which is the reason several are configured
 * in the first place.
 */
export async function sendWebhook(
  urls: string[],
  payload: unknown,
  options: SendOptions = {}
): Promise<WebhookResult[]> {
  if (urls.length === 0) return []

  const {
    secret,
    token,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    now = () => new Date(),
    eventId,
    event,
  } = options

  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(now().getTime() / 1000))

  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: timestamp,
      }
      if (secret) {
        headers[SIGNATURE_SECRET_HEADER] = signPayload(body, timestamp, secret)
      }
      if (token) {
        headers[TOKEN_HEADER] = `Bearer ${token}`
      }
      // Added after the signing headers on purpose: these two cannot invalidate
      // the signature, whereas letting a caller overwrite `x-webhook-signature`
      // would let it ship an unsigned or wrongly-signed body.
      if (eventId) {
        headers[ID_HEADER] = eventId
      }
      if (event) {
        headers[EVENT_HEADER] = event
      }

      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        return {
          url,
          success: false,
          status: response.status,
          error: `${response.status} ${response.statusText}`,
        }
      }
      return { url, success: true, status: response.status }
    })
  )

  return settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          url: urls[index]!,
          success: false,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        }
  )
}

/** True when at least one endpoint accepted the payload. */
export function hasAccepted(results: WebhookResult[]): boolean {
  return results.some((result) => result.success)
}

/**
 * One line per endpoint, for the task log.
 *
 * Errors are summarised rather than thrown: a task that cannot reach a webhook
 * has still done its real work, and failing the run would make the history
 * report a failure that reads like lost data.
 */
export function summarise(results: WebhookResult[]): string {
  if (results.length === 0) return "no endpoints configured"

  const accepted = results.filter((result) => result.success).length
  if (accepted === results.length)
    return `${accepted}/${results.length} accepted`

  const failures = results
    .filter((result) => !result.success)
    .map((result) => `${result.url} (${result.error ?? "unknown"})`)

  return `${accepted}/${results.length} accepted, failed: ${failures.join(", ")}`
}
