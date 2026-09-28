import crypto from "node:crypto"
import { createPuzzle } from "./puzzle-generator"
import { getPrefix, getSharedRedis } from "./redis"
import type { SmsCaptchaConfig, CreateJigsawChallengeResult, VerifyJigsawResult } from "../types"

const CHALLENGE_RESERVED = "sms_captcha_challenge:"
const TOKEN_RESERVED = "sms_captcha_token:"

type ChallengeData = {
  x: number
  y: number
  attempts: number
  bgBase64: string
  puzzleBase64: string
}

function getTTL(config?: SmsCaptchaConfig) {
  return config?.ttl ?? 120
}

function getMaxAttempts(config?: SmsCaptchaConfig) {
  return config?.maxAttempts ?? 5
}

function getTolerancePx(config?: SmsCaptchaConfig) {
  return config?.tolerancePx ?? 12
}

function getAppUrl(config?: SmsCaptchaConfig) {
  // 默认空串 → 同源相对路径。不要回退到 NEXT_PUBLIC_APP_URL：
  // Next.js 会在构建期把该值内联，Docker 占位 http://localhost 会在 HTTPS 站点触发 Mixed Content。
  return config?.appUrl?.replace(/\/$/, "") ?? ""
}

function getApiBasePath(config?: SmsCaptchaConfig) {
  return config?.apiBasePath ?? "/api/auth/sms-captcha"
}

/**
 * 创建拼图 challenge：生成 bg/puzzle，存 Redis，返回 challengeId 与图片 URL（不包含 x,y）
 */
export async function createJigsawChallenge(
  config?: SmsCaptchaConfig
): Promise<CreateJigsawChallengeResult> {
  const r = getSharedRedis(config)
  if (!r) throw new Error("Redis unavailable")
  const prefix = getPrefix(config)
  const challengeId = crypto.randomUUID()
  const { bg, puzzle, x, y } = await createPuzzle(undefined, {
    galleryDir: config?.galleryDir,
  })
  const data: ChallengeData = {
    x,
    y,
    attempts: 0,
    bgBase64: bg.toString("base64"),
    puzzleBase64: puzzle.toString("base64"),
  }
  const value = JSON.stringify(data)
  await r.setex(prefix + CHALLENGE_RESERVED + challengeId, getTTL(config), value)

  const base = getAppUrl(config)
  const apiBase = getApiBasePath(config)
  const bgUrl = `${base}${apiBase}/image?challengeId=${encodeURIComponent(challengeId)}&type=bg`
  const puzzleUrl = `${base}${apiBase}/image?challengeId=${encodeURIComponent(challengeId)}&type=puzzle`

  return { challengeId, bgUrl, puzzleUrl, puzzleY: data.y }
}

/**
 * 根据 challengeId 与 type 取背景图或拼图 Buffer
 */
export async function getChallengeImage(
  challengeId: string,
  type: "bg" | "puzzle",
  config?: SmsCaptchaConfig
): Promise<Buffer | null> {
  const r = getSharedRedis(config)
  if (!r) return null
  const prefix = getPrefix(config)
  const raw = await r.get(prefix + CHALLENGE_RESERVED + challengeId)
  if (!raw) return null
  const data = JSON.parse(raw) as ChallengeData
  const b64 = type === "bg" ? data.bgBase64 : data.puzzleBase64
  return Buffer.from(b64, "base64")
}

/**
 * 拼图校验：比对前端提交的 x 与 Redis 中存储的缺口位置，通过则发放一次性 token
 */
export async function verifyJigsawChallenge(
  challengeId: string,
  x: number,
  y?: number,
  config?: SmsCaptchaConfig
): Promise<VerifyJigsawResult> {
  const r = getSharedRedis(config)
  if (!r) return { ok: false, error: "INVALID_CHALLENGE" }
  const prefix = getPrefix(config)
  const key = prefix + CHALLENGE_RESERVED + challengeId
  const raw = await r.get(key)
  if (!raw) return { ok: false, error: "INVALID_CHALLENGE" }
  const data = JSON.parse(raw) as ChallengeData

  if (data.attempts >= getMaxAttempts(config)) {
    await r.del(key)
    return { ok: false, error: "TOO_MANY_ATTEMPTS" }
  }

  void y
  const diffX = Math.abs(x - data.x)
  const pass = diffX <= getTolerancePx(config)

  if (!pass) {
    data.attempts += 1
    await r.setex(key, getTTL(config), JSON.stringify(data))
    return { ok: false, error: "SLIDER_MISMATCH" }
  }

  await r.del(key)
  const token = crypto.randomBytes(16).toString("hex")
  await r.setex(prefix + TOKEN_RESERVED + token, getTTL(config), "1")
  return { ok: true, token }
}

/**
 * 校验并消费 token（一次性），存在则删除并返回 true；供 Better-Auth 插件使用
 */
export async function consumeAndValidateToken(
  token: string,
  config?: SmsCaptchaConfig
): Promise<boolean> {
  const r = getSharedRedis(config)
  if (!r) return false
  const prefix = getPrefix(config)
  const key = prefix + TOKEN_RESERVED + token
  const exists = await r.get(key)
  if (!exists) return false
  await r.del(key)
  return true
}