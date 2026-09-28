import { NextRequest, NextResponse } from "next/server"
import { createJigsawChallenge } from "../sms-captcha-server"
import { checkRateLimit, consumeRateLimit } from "../rate-limiter"
import { getClientIp } from "../ip"
import type { SmsCaptchaConfig } from "../../types"

export function createChallengeHandler(config?: SmsCaptchaConfig) {
  return async function POST(request: NextRequest) {
    try {
      const ip = getClientIp(request)
      const ok = (
        await checkRateLimit("smsCaptchaChallengeIpMinute", ip, config)
      ).ok
      if (!ok) {
        return NextResponse.json(
          { error: "TOO_MANY_REQUESTS", message: "获取验证码过于频繁，请稍后再试" },
          { status: 429 }
        )
      }
      await consumeRateLimit(
        "smsCaptchaChallengeIpMinute",
        ip,
        { throws: true },
        config
      )
      const result = await createJigsawChallenge(config)
      return NextResponse.json(result)
    } catch (e) {
      if (e instanceof Error && e.message?.includes("Rate limit")) {
        return NextResponse.json(
          { error: "TOO_MANY_REQUESTS", message: "获取验证码过于频繁，请稍后再试" },
          { status: 429 }
        )
      }
      console.warn("[sms-captcha challenge]", e)
      return NextResponse.json(
        { error: "CHALLENGE_FAILED" },
        { status: 500 }
      )
    }
  }
}

export function createChallengeGetHandler(config?: SmsCaptchaConfig) {
  const postHandler = createChallengeHandler(config)
  return async function GET(request: NextRequest) {
    return postHandler(request)
  }
}