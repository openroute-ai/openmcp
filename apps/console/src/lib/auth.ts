import { createAuth } from "@workspace/auth"
import {
  checkAndConsumeSmsRateLimit,
  consumeAndValidateToken,
  getClientIp,
} from "@workspace/sms-captcha/server"
import { phoneNumber } from "better-auth/plugins"
import { APIError } from "better-auth/api"
import { db } from "@/db/client"
import { authSchema } from "@/db/schema"
import { getRateLimitStorage } from "@/lib/redis"
import { smsCaptchaConfig } from "@/lib/sms-captcha"
import { sendSmsCode } from "@/lib/sms"

const storage = getRateLimitStorage()

const githubClientId = process.env.GITHUB_CLIENT_ID
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET

const CN_PHONE = /^1[3-9]\d{9}$/

const tempEmailDomain = process.env.CONSOLE_TEMP_EMAIL_DOMAIN ?? "console.local"

export const auth = createAuth(db, {
  baseURL: process.env.CONSOLE_BETTER_AUTH_URL ?? "http://localhost:3001",
  schema: authSchema,
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim())
    : [],
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
    },
  },
  ...(storage
    ? {
        rateLimit: {
          window: 60,
          max: 100,
          storage,
        },
      }
    : {}),
  ...(githubClientId && githubClientSecret
    ? {
        socialProviders: {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
          },
        },
      }
    : {}),
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }, request) => {
        if (!CN_PHONE.test(phone)) {
          throw new APIError("BAD_REQUEST", { message: "无效的手机号" })
        }

        // 滑块验证码一次性 token：缺失或非法直接拒绝，防止短信轰炸
        const captchaToken = request?.headers?.get("x-temp-captcha-token")
        if (
          !captchaToken ||
          !(await consumeAndValidateToken(captchaToken, smsCaptchaConfig))
        ) {
          throw new APIError("BAD_REQUEST", { message: "请先通过滑块安全验证" })
        }

        // 每手机号 1 次/分钟、5 次/小时；每 IP 10 次/小时
        const ip = getClientIp(request)
        try {
          await checkAndConsumeSmsRateLimit(phone, ip, smsCaptchaConfig)
        } catch (error) {
          if (error instanceof Error) {
            throw new APIError("TOO_MANY_REQUESTS", { message: error.message })
          }
          throw error
        }

        await sendSmsCode(phone, code)
      },
      signUpOnVerification: {
        getTempEmail: (phoneNumber: string) => {
          return `${phoneNumber}@${tempEmailDomain}`
        },
        getTempName: (phoneNumber: string) => {
          return phoneNumber
        },
      },
    }),
  ],
})

export const GITHUB_CONFIGURED = Boolean(githubClientId && githubClientSecret)

export const AUTH_RATE_LIMIT_ENABLED = storage != null