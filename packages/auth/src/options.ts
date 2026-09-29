import type { BetterAuthOptions } from "better-auth"
import { openAPI, phoneNumber } from "better-auth/plugins"
import { consumeAndValidateToken } from "@workspace/sms-captcha/server"

/**
 * Sends the one-time password for phone sign-in.
 *
 * A captcha token is mandatory: the sign-in form always solves the slider
 * challenge first and forwards the resulting token via `x-temp-captcha-token`.
 * Requests without one, or with a token that has already been consumed, are
 * dropped without sending anything, so a scripted client cannot burn through
 * SMS quota or lock a real phone number out with repeated attempts.
 */
async function sendPhoneOtp(
  { phoneNumber: phone, code }: { phoneNumber: string; code: string },
  context?: { request?: Request }
): Promise<void> {
  const captchaToken = context?.request?.headers?.get("x-temp-captcha-token")

  if (captchaToken) {
    const valid = await consumeAndValidateToken(captchaToken)
    if (!valid) {
      console.warn(`[auth] Invalid captcha token for phone ${phone}`)
      return
    }
  } else {
    console.warn(`[auth] Missing captcha token for phone ${phone}`)
    return
  }

  // Wire this to the real SMS provider; the reference app logs the code in
  // development so a phone login can be exercised without a gateway.
  console.log(`[sms] Sending OTP ${code} to ${phone}`)
}

// `satisfies` rather than an explicit `: Partial<BetterAuthOptions>` annotation:
// the annotation would widen away the literal shape of `user.additionalFields`,
// and the client derives its `role` typing from `typeof auth` via
// `inferAdditionalFields`. The phone plugin's inferred return type references
// zod v4 internals, so the plugin list is typed as `BetterAuthOptions` to keep
// that out of the exported signature.
const plugins: NonNullable<BetterAuthOptions["plugins"]> = [
  phoneNumber({
    sendOTP: sendPhoneOtp,
    signUpOnVerification: {
      // Phone-only accounts still need the `email` column to be unique, so a
      // synthetic address is derived from the verified number.
      getTempEmail: (phone: string) => `${phone}@phone.openmcp.cn`,
      getTempName: (phone: string) => phone,
    },
  }),
  openAPI(),
]

export const sharedAuthOptions = {
  emailAndPassword: {
    enabled: true,
  },
  user: {
    // Exposes the platform role on the session so the client can gate
    // role-restricted navigation.
    // https://www.better-auth.com/docs/concepts/database#extending-core-schema
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  plugins,
} satisfies Partial<BetterAuthOptions>
