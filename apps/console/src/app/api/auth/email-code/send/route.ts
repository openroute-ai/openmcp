/**
 * Re-sends the sign-up verification code.
 *
 * The first code goes out by itself: better-auth calls `sendVerificationEmail`
 * during sign-up, which issues the code and mails it. This route exists for the
 * two cases that is not enough for — the mail never arrived, or the reader
 * mistyped the address and wants a second copy at the right one.
 *
 * It answers the same way whether or not the address has an account. Reporting
 * "no such account" would turn this into the account-existence oracle that
 * `requireEmailVerification` deliberately removes from sign-up.
 */
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { db } from "@/db/client"
import { user } from "@/db/schema"
import {
  claimResendSlot,
  EMAIL_CODE_RESEND_COOLDOWN_SECONDS,
  EMAIL_CODE_TTL_SECONDS,
  generateEmailCode,
  issueEmailCode,
  normalizeEmail,
} from "@/lib/auth/email-code"
import { isMailConfigured, mailLocaleFrom, sendEmail } from "@/lib/mail"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  let email: string
  try {
    const body = (await request.json()) as { email?: unknown }
    email = typeof body.email === "string" ? normalizeEmail(body.email) : ""
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 })
  }

  // Claimed rather than checked: two resend buttons pressed together must not
  // both be told yes.
  if (!(await claimResendSlot(email))) {
    return NextResponse.json(
      { error: "too_soon", retryAfter: EMAIL_CODE_RESEND_COOLDOWN_SECONDS },
      { status: 429 }
    )
  }

  // Only send to an address that has an account. The response is the same either
  // way — `{ ok: true }` — so this is not an existence oracle; without it this
  // endpoint would mail a code to whichever address a stranger names, which is a
  // way to use the deployment as a mail relay.
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)

  if (!account) {
    return NextResponse.json({ ok: true })
  }

  const code = generateEmailCode()
  await issueEmailCode(email, code)

  if (isMailConfigured()) {
    await sendEmail({
      to: email,
      template: "verifyEmailCode",
      locale: mailLocaleFrom(request),
      context: {
        name: "",
        code,
        expiresInMinutes: Math.round(EMAIL_CODE_TTL_SECONDS / 60),
      },
    })
  } else {
    console.warn(`[mail:test] verification code for ${email}: ${code}`)
  }

  return NextResponse.json({ ok: true })
}
