import type Redis from "ioredis"

export type CreateJigsawChallengeResult = {
  challengeId: string
  bgUrl: string
  puzzleUrl: string
  puzzleY: number
}

export type VerifyJigsawResult =
  | { ok: true; token: string }
  | { ok: false; error: "INVALID_CHALLENGE" | "SLIDER_MISMATCH" | "TOO_MANY_ATTEMPTS" }

export type SmsCaptchaConfig = {
  /** 已连接的 ioredis 实例；缺省时按 REDIS_HOST/PORT/PASSWORD/DB 环境变量自行创建 */
  redis?: Redis
  /** key 前缀，用于区分应用/环境，默认 "" */
  prefix?: string
  /** 拼图图片目录（相对 process.cwd()），默认 'public/images/blog' */
  galleryDir?: string
  /** challenge/token TTL 秒数，默认 120 */
  ttl?: number
  /** 最大尝试次数，默认 5 */
  maxAttempts?: number
  /** x 像素容差，默认 12 */
  tolerancePx?: number
  /** 应用 URL（用于生成图片访问地址）。默认空，返回同源相对路径 */
  appUrl?: string
  /** API 路由基础路径，默认 '/api/auth/sms-captcha' */
  apiBasePath?: string
}

export type RateLimitType =
  | "smsPhoneMinute"
  | "smsPhoneHour"
  | "smsIpHour"
  | "smsCaptchaChallengeIpMinute"
  | "smsCaptchaVerifyIpMinute"

export type RateLimitResult = {
  ok: boolean
  remaining: number
  resetTime: number
  total: number
}

/** 兼容 better-auth 等传入的 context（可能带 request 或 headers） */
export type RequestLike = Request | { request?: Request; headers?: Headers } | undefined