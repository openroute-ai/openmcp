/**
 * Sends the confirmation code for binding a phone number.
 *
 * The same three guards stand in front of this as in front of the sign-in code
 * (`lib/auth.ts`): a slider captcha, one SMS per minute per number and a few
 * per hour, and a per-IP hourly cap. Without them this endpoint is a way to
 * spend money sending SMS to arbitrary numbers — the captcha token is checked
 * first precisely because it is the only thing that makes an automated caller
 * pay for it.
 */
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import {
  checkAndConsumeSmsRateLimit,
  consumeAndValidateToken,
  getClientIp,
} from "@workspace/sms-captcha/server"

import { db } from "@/db/client"
import { user } from "@/db/schema"
import { getFullSessionUser } from "@/lib/auth/session"
import { generatePhoneCode, issuePhoneCode } from "@/lib/auth/phone-code"
import { smsCaptchaConfig } from "@/lib/sms-captcha"
import { sendSmsCode } from "@/lib/sms"

const CN_PHONE = /^1[3-9]\d{9}$/

export async function POST(request: Request) {
  const session = await getFullSessionUser()
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let phoneNumber: string
  try {
    const body = (await request.json()) as { phoneNumber?: unknown }
    phoneNumber =
      typeof body.phoneNumber === "string"
        ? body.phoneNumber.replace(/\D/g, "")
        : ""
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!CN_PHONE.test(phoneNumber)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 })
  }

  // Asked before the SMS is paid for: a number that is already claimed can never
  // be bound, so sending a code to it would be money spent to learn nothing.
  // Saying so is not a leak — the sign-in flow answers the same question.
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.phoneNumber, phoneNumber))

  if (existing && existing.id !== session.id) {
    return NextResponse.json({ error: "phone_in_use" }, { status: 409 })
  }

  const captchaToken = request.headers.get("x-temp-captcha-token")
  if (
    !captchaToken ||
    !(await consumeAndValidateToken(captchaToken, smsCaptchaConfig))
  ) {
    return NextResponse.json({ error: "captcha_required" }, { status: 400 })
  }

  const ip = getClientIp(request)
  try {
    await checkAndConsumeSmsRateLimit(phoneNumber, ip, smsCaptchaConfig)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "too_many_requests"
    return NextResponse.json({ error: message }, { status: 429 })
  }

  const code = generatePhoneCode()
  await issuePhoneCode(session.id, phoneNumber, code)

  try {
    await sendSmsCode(phoneNumber, code)
  } catch (error) {
    console.error("[console] phone code send failed:", error)
    return NextResponse.json({ error: "send_failed" }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
