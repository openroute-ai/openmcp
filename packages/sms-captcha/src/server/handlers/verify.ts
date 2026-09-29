import { NextRequest, NextResponse } from "next/server"
import { verifyJigsawChallenge } from "../sms-captcha-server"
import { checkRateLimit, consumeRateLimit } from "../rate-limiter"
import { getClientIp } from "../ip"
import type { SmsCaptchaConfig } from "../../types"

export function createVerifyHandler(config?: SmsCaptchaConfig) {
  return async function POST(request: NextRequest) {
    try {
      const ip = getClientIp(request)
      const ok = (
        await checkRateLimit("smsCaptchaVerifyIpMinute", ip, config)
      ).ok
      if (!ok) {
        return NextResponse.json(
          { error: "TOO_MANY_REQUESTS", message: "验证请求过于频繁，请稍后再试" },
          { status: 429 }
        )
      }
      await consumeRateLimit(
        "smsCaptchaVerifyIpMinute",
        ip,
        { throws: true },
        config
      )

      const body = (await request.json().catch(() => ({}))) as {
        challengeId?: unknown
        x?: unknown
        y?: unknown
      }
      const challengeId = body?.challengeId
      const x = typeof body?.x === "number" ? body.x : undefined
      const y = typeof body?.y === "number" ? body.y : undefined
      if (typeof challengeId !== "string" || x == null) {
        return NextResponse.json(
          { error: "INVALID_REQUEST" },
          { status: 400 }
        )
      }
      const result = await verifyJigsawChallenge(challengeId, x, y, config)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      return NextResponse.json({ success: true, token: result.token })
    } catch (e) {
      console.warn("[sms-captcha verify]", e)
      return NextResponse.json({ error: "VERIFY_FAILED" }, { status: 500 })
    }
  }
}