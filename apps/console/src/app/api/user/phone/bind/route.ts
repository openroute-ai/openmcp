/**
 * Binds a verified phone number to the signed-in account.
 *
 * Written straight to the `user` row because better-auth refuses the same write
 * through `/update-user` — the phone-number plugin hooks that path and throws
 * `PHONE_NUMBER_CANNOT_BE_UPDATED`, on the reasoning that a number is claimed at
 * sign-in rather than afterwards. This route is the after.
 *
 * The unique index on `user.phone_number` is the real guard against two accounts
 * claiming one number: two concurrent requests can both pass the lookup above
 * and both reach the write, and only the index arbitrates. Its error is reported
 * as "already in use" rather than surfaced as a 500.
 */
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { db } from "@/db/client"
import { user } from "@/db/schema"
import { getFullSessionUser } from "@/lib/auth/session"
import { verifyPhoneCode } from "@/lib/auth/phone-code"

const CN_PHONE = /^1[3-9]\d{9}$/
const CODE_REGEX = /^\d{6}$/

/** Postgres `unique_violation`. Named rather than matched on message text. */
const UNIQUE_VIOLATION = "23505"

export async function POST(request: Request) {
  const session = await getFullSessionUser()
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let phoneNumber: string
  let code: string
  try {
    const body = (await request.json()) as {
      phoneNumber?: unknown
      code?: unknown
    }
    phoneNumber =
      typeof body.phoneNumber === "string"
        ? body.phoneNumber.replace(/\D/g, "")
        : ""
    code = typeof body.code === "string" ? body.code.trim() : ""
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!CN_PHONE.test(phoneNumber) || !CODE_REGEX.test(code)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const result = await verifyPhoneCode(session.id, phoneNumber, code)
  if (!result.ok) {
    if (result.reason === "tooManyAttempts") {
      return NextResponse.json({ error: "too_many_attempts" }, { status: 429 })
    }
    return NextResponse.json({ error: "invalid_code" }, { status: 400 })
  }

  try {
    await db
      .update(user)
      .set({ phoneNumber, phoneNumberVerified: true })
      .where(eq(user.id, session.id))
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      return NextResponse.json({ error: "phone_in_use" }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json({ ok: true, phoneNumber })
}
