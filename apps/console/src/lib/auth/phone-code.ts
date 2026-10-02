/**
 * The code that confirms a phone number belongs to the person binding it.
 *
 * Why this exists rather than the phone-number plugin's own OTP endpoints:
 * better-auth registers `/phone-number/send-otp` and `/phone-number/verify` for
 * *signing in*, and it blocks phone numbers from being set through
 * `/update-user` outright (`PHONE_NUMBER_CANNOT_BE_UPDATED`). Binding a number
 * to an account that already has a session is a third thing, and the plugin has
 * no endpoint for it — so the code is minted, sent and checked here.
 *
 * Subject is `userId:phone`, not the phone alone: the code proves that *this
 * signed-in person* controls the number, and a number can only be claimed once,
 * so a code issued for one account must not be spendable on another.
 */
import { createOtpStore, generateNumericCode } from "./otp-store"

/** Five minutes: an SMS is read immediately or not at all. */
export const PHONE_CODE_TTL_SECONDS = 300
/** Misses allowed per issued code before it is destroyed. */
const MAX_ATTEMPTS = 5

const store = createOtpStore({
  namespace: "phone-code",
  ttlSeconds: PHONE_CODE_TTL_SECONDS,
  maxAttempts: MAX_ATTEMPTS,
})

export function generatePhoneCode(): string {
  return generateNumericCode(6)
}

export function issuePhoneCode(
  userId: string,
  phoneNumber: string,
  code: string
): Promise<void> {
  return store.issue(`${userId}:${phoneNumber}`, code)
}

export function verifyPhoneCode(
  userId: string,
  phoneNumber: string,
  code: string
): ReturnType<typeof store.verify> {
  return store.verify(`${userId}:${phoneNumber}`, code)
}
