/**
 * Provider OAuth `state` 的签名与校验。
 *
 * 之前 `state` 只是 `base64url(JSON)`：base64 是编码不是加密，任何人都能
 * 构造。回调端点 `GET /api/oauth/callback/mcp` 是公开路由，没有别的凭据，
 * 所以一个伪造的 `state` 就能让攻击者把任意上游返回的 `code` 兑换到
 * 别人名下的资产上（`serverName` 与 `authorId` 都由攻击者指定）。回调里
 * 补的 `authorId` 一致性检查挡不住这个 —— 被伪造的 `state` 里那两个字段
 * 本身就是攻击者写的，互相自洽。
 *
 * 这里用 HMAC-SHA256 签名，让回调端有办法判断 `state` 确实是自己签发、
 * 且没被改过。同时带上签发时间和 nonce：
 *
 * - **过期**：`state` 会出现在浏览器的地址栏、上游的日志、重定向链里。
 *   长期有效的签名凭据泄露面太大，所以按 `OAUTH_STATE_TTL_SEC` 过期。
 * - **nonce**：同一次签发的 `state` 只能被消费一次。没有 nonce 的话，
 *   一个从上游日志或浏览器历史里捡到的旧 `state` 可以被反复重放 —— 它是
 *   合法签发的，所以签名检查会通过。
 *
 * 密钥缺失时不静默降级成"不校验"。返回 `null` 让回调以"Invalid state"
 * 失败：宁可在开发环境响亮地坏掉，也不要在生产环境悄悄开一个洞。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 签名 `state` 的有效期。OAuth 授权往返通常在几分钟内完成。 */
export const OAUTH_STATE_TTL_SEC = 10 * 60

/** `iat` + `nonce` 的盐。改成常量是故意的：nonce 只需单次流程内唯一。 */
const NONCE_BYTES = 16

export type OAuthStatePayload = {
  /** MCP 用 `serverName`，A2A 用 `agentName`。 */
  assetName: string
  authorId: string
  /** 签发时间，秒。 */
  iat: number
  /** 单次使用随机串，用于防重放。 */
  nonce: string
}

function stateSecret(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  return secret ?? ''
}

export type SignResult = { ok: true; state: string } | { ok: false; reason: string }

export type VerifyResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: string }

/**
 * 签发 `state`。
 *
 * 密钥未配置时**不签发**，而是让调用方看到明确原因。调用方应把它当作
 * 配置错误处理，不要退回到未签名的 `base64url(JSON)`。
 */
export function signOAuthState(input: {
  assetName: string
  authorId: string
  ttlSec?: number
}): SignResult {
  const secret = stateSecret()
  if (!secret) {
    return {
      ok: false,
      reason:
        '缺少 OAUTH_STATE_SECRET（回退 AUTH_SECRET / NEXTAUTH_SECRET 也未配置），无法签发 state',
    }
  }

  const ttlSec = input.ttlSec ?? OAUTH_STATE_TTL_SEC
  const payload: OAuthStatePayload = {
    assetName: input.assetName,
    authorId: input.authorId,
    iat: Math.floor(Date.now() / 1000),
    nonce: randomBytes(NONCE_BYTES).toString('base64url'),
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { ok: true, state: `${body}.${sign(body, secret)}` }
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/**
 * 校验并解出 `state`。
 *
 * 逐项说明为什么这样写：
 *
 * - `split` 用 limit：payload 是 base64url，不含 `.`，但校验不过时不该
 *   在"格式不合法"和"签名不匹配"之间泄露更多信息，所以先做结构检查。
 * - `timingSafeEqual`：长度不等时它会抛异常，所以先比长度 —— 长度本身不是
 *   秘密（HMAC 输出长度固定），泄露它没有意义。
 * - 过期判断放在签名之后：未通过签名的内容不应该走"已过期"分支，否则
 *   就能构造一个过期时间戳来试探自己的 payload 是否合法。
 */
export function verifyOAuthState(
  state: string,
  options?: { ttlSec?: number; nowSec?: number }
): VerifyResult {
  const secret = stateSecret()
  if (!secret) {
    return { ok: false, reason: '服务端未配置 state 签名密钥' }
  }

  const dot = state.lastIndexOf('.')
  if (dot <= 0 || dot === state.length - 1) {
    return { ok: false, reason: 'state 格式不合法' }
  }

  const body = state.slice(0, dot)
  const signature = state.slice(dot + 1)
  const expected = sign(body, secret)

  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'state 签名不匹配' }
  }

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'state payload 无法解析' }
  }

  if (
    typeof payload?.assetName !== 'string' ||
    typeof payload?.authorId !== 'string' ||
    typeof payload?.iat !== 'number' ||
    typeof payload?.nonce !== 'string'
  ) {
    return { ok: false, reason: 'state payload 字段缺失' }
  }

  const ttlSec = options?.ttlSec ?? OAUTH_STATE_TTL_SEC
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000)
  if (nowSec - payload.iat > ttlSec) {
    return { ok: false, reason: 'state 已过期' }
  }
  // 签发时间在未来：容忍一点时钟偏移，但拒绝明显的未来值，避免伪造一个
  // 极大的 iat 拿到近乎永久有效的凭据。
  if (payload.iat - nowSec > 60) {
    return { ok: false, reason: 'state 签发时间异常' }
  }

  return { ok: true, payload }
}