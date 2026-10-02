/**
 * Checks the six-digit code from the verification mail and, when it matches,
 * marks the address verified.
 *
 * This is the other half of `sendVerificationEmail` in `lib/auth.ts`: better-auth
 * issues the code there but keeps no copy, so the check lives here and writes
 * `emailVerified` directly. Sign-in then stops refusing the account, because
 * that refusal is exactly this column.
 *
 * No session is required — the reader has not got one yet, which is the whole
 * point of this step. The code is the credential, and it is scoped to one
 * address with a short life and a handful of attempts (see `lib/auth/email-code`).
 */
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { db } from "@/db/client"
import { user } from "@/db/schema"
import { normalizeEmail, verifyEmailCode } from "@/lib/auth/email-code"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_REGEX = /^\d{6}$/

/** better-auth refuses sign-in with this code; the UI maps it to the form here. */
const EMAIL_NOT_VERIFIED = { error: "email_not_verified" }

export async function POST(request: Request) {
  let email: string
  let code: string
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown }
    email = typeof body.email === "string" ? normalizeEmail(body.email) : ""
    code = typeof body.code === "string" ? body.code.trim() : ""
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!EMAIL_REGEX.test(email) || !CODE_REGEX.test(code)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const result = await verifyEmailCode(email, code)
  if (!result.ok) {
    if (result.reason === "tooManyAttempts") {
      return NextResponse.json(
        { error: "too_many_attempts" },
        { status: 429 }
      )
    }
    return NextResponse.json(EMAIL_NOT_VERIFIED, { status: 400 })
  }

  // A correct code for an address with no account means the sign-up that
  // requested it was never submitted. Saying so is safe here — whoever reached
  // this line proved they can read mail at the address, which is the same thing
  // the account's owner knows — and it is what the client needs in order to
  // send the reader to sign-up instead of asking for a password they never set.
  const updated = await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email))
    .returning({ id: user.id })

  if (updated.length === 0) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
