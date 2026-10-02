/**
 * Signed unsubscribe links.
 *
 * A link in a mail has to prove the recipient owns the address without a
 * session, so the address is signed with the app's existing auth secret rather
 * than a new one. HMAC over the normalized address means the token is
 * deterministic — the same link can be re-sent and stays valid — and forged
 * links fail without storing a per-row token that could leak.
 *
 * No secret configured means no link: the caller omits it and logs instead, the
 * same way mail without a transport degrades, rather than mailing a link no one
 * can verify.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

/** Same normalization the subscribe route stores under, so the HMAC matches. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function signingSecret(): string | null {
  return process.env.BETTER_AUTH_SECRET ?? null
}

/** The hex digest for an address, or null when no signing secret is configured. */
export function unsubscribeToken(email: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  return createHmac("sha256", secret).update(normalizeEmail(email)).digest("hex")
}

/** True when `token` is the digest for `email`. Constant-time on equal lengths. */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email)
  if (!expected) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The absolute link to put in a mail, or null when no secret is configured. */
export function unsubscribeUrl(email: string, origin: string): string | null {
  const token = unsubscribeToken(email)
  if (!token) return null
  const url = new URL("/api/newsletter/unsubscribe", origin)
  url.searchParams.set("email", normalizeEmail(email))
  url.searchParams.set("token", token)
  return url.toString()
}
