/**
 * The shared guard for endpoints that external systems call with the secret.
 *
 * The Cron entrypoint and the inbound trigger webhook both authenticate the
 * same way - a `Bearer` header compared in constant time - and both fail
 * closed (404 rather than 401) when no secret is configured at all, so an
 * unconfigured instance does not confirm the route exists.
 */

import { timingSafeEqual } from "node:crypto"

/**
 * Constant-time comparison of the bearer token.
 *
 * A plain `===` on a secret is a timing oracle, and these endpoints are
 * unauthenticated by default. Length is compared first because
 * `timingSafeEqual` throws on a length mismatch, and the length of a secret is
 * not itself the secret.
 */
export function authorized(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const given = Buffer.from(header)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false
  return timingSafeEqual(given, wanted)
}
