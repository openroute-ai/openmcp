import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { openAPI, phoneNumber } from "better-auth/plugins"
import {
  checkAndConsumeSmsRateLimit,
  consumeAndValidateToken,
  getClientIp,
} from "@workspace/sms-captcha/server"
import { db } from "@/db/client"
import { schema as consoleSchema } from "@/db/schema"
import { getRateLimitStorage } from "@/lib/redis"
import { smsCaptchaConfig } from "@/lib/sms-captcha"
import { sendSmsCode } from "@/lib/sms"

/**
 * Console's own Better Auth instance, built on the library directly.
 *
 * It used to come from `@workspace/auth`'s `createAuth`, which is now web/api's
 * to own. Console has its own database and its own `user` table (see
 * `src/db/schema.ts`), so there was no shared identity left to abstract: the
 * wrapper's only remaining job was to concat a shared plugin list with the
 * console's, and because both declared `phoneNumber()` that registered the same
 * five endpoints twice. Owning the configuration outright means the plugin list
 * has exactly one entry and cannot drift into a second copy.
 */
const storage = getRateLimitStorage()

const githubClientId = process.env.GITHUB_CLIENT_ID
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET

const CN_PHONE = /^1[3-9]\d{9}$/

const tempEmailDomain = process.env.CONSOLE_TEMP_EMAIL_DOMAIN ?? "console.local"

// Better Auth's own defaults: `basePath` stays `/api/auth`, the directory the
// handler is mounted at, and `baseURL` is read from `BETTER_AUTH_URL`. Setting
// either here would be a second place to keep in step with the deployment, and
// a stale one is exactly what makes a sign-in fail as an untrusted origin.
export const auth = betterAuth({
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim())
    : [],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: consoleSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    // Carries the platform role on the session so the client can gate
    // role-restricted navigation, and the console's admin procedures can ask
    // for `role === "admin"` without a second lookup.
    // https://www.better-auth.com/docs/concepts/database#extending-core-schema
    //
    // `input: false` keeps the field off sign-up: a client could otherwise
    // nominate itself admin by including `role` in its sign-up body.
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
    },
  },
  ...(storage
    ? {
        rateLimit: {
          enabled: true,
          window: 60,
          max: 100,
          customStorage: storage,
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
        // Phone-only accounts still need a unique `email`, so a synthetic
        // address is derived from the verified number.
        getTempEmail: (phoneNumber: string) =>
          `${phoneNumber}@${tempEmailDomain}`,
        getTempName: (phoneNumber: string) => phoneNumber,
      },
    }),
    openAPI(),
  ],
})

export const GITHUB_CONFIGURED = Boolean(githubClientId && githubClientSecret)

export const AUTH_RATE_LIMIT_ENABLED = storage != null
