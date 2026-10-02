/**
 * The email verification code: issuing it, and deciding whether one was typed
 * correctly.
 *
 * The storage rules — digest, short life, bounded guesses — are in
 * `otp-store.ts`, which the phone-binding flow shares. What is left here is the
 * email-specific part: the address it is keyed on, and the per-address resend
 * window that keeps a "resend" button from being a mail cannon.
 *
 * better-auth issues no code of its own that we could check later: its
 * `sendVerificationEmail` callback receives a signed token for a link, which is
 * not what this console asks readers to type. So the code is minted here and
 * checked by `POST /api/auth/email-code/verify`.
 */
import { createOtpStore, generateNumericCode } from "./otp-store"

/** Ten minutes: long enough to find the mail, short enough to not be a standing credential. */
export const EMAIL_CODE_TTL_SECONDS = 600
/** One resend per minute per address. */
export const EMAIL_CODE_RESEND_COOLDOWN_SECONDS = 60
/** Misses allowed per issued code before it is destroyed. */
const MAX_ATTEMPTS = 5

const store = createOtpStore({
  namespace: "email-code",
  ttlSeconds: EMAIL_CODE_TTL_SECONDS,
  maxAttempts: MAX_ATTEMPTS,
})

export type EmailCodeResult = Awaited<ReturnType<typeof store.verify>>

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function generateEmailCode(): string {
  return generateNumericCode(6)
}

/** Stores a fresh code, replacing any earlier one for the same address. */
export function issueEmailCode(email: string, code: string): Promise<void> {
  return store.issue(normalizeEmail(email), code)
}

/** True when a resend slot was available and has now been taken. */
export function claimResendSlot(email: string): Promise<boolean> {
  return store.claimSlot(
    `resend:${normalizeEmail(email)}`,
    EMAIL_CODE_RESEND_COOLDOWN_SECONDS
  )
}

export function verifyEmailCode(
  email: string,
  code: string
): Promise<EmailCodeResult> {
  return store.verify(normalizeEmail(email), code)
}
