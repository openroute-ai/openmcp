/**
 * The open API's credential vocabulary and the arithmetic around the secret.
 *
 * The plaintext format is a contract with clients that already exist in the
 * wild once this ships, so the prefix is a constant and the parse is tested
 * against the shapes clients actually send — including the malformed ones that
 * must not be silently accepted.
 */

export const API_SCOPES = [
  "repos:read",
  "repos:write",
  "rankings:read",
  "subscriptions:write",
] as const

export type ApiScope = (typeof API_SCOPES)[number]

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value)
}

/**
 * 明文格式 `mcp_radar_<prefix>_<secret>`。
 *
 * 选它而不是 `sk-` 是因为这把 key 只在 console 一个地方被验证，固定前缀的作用
 * 是让人在日志和 secret 扫描里一眼认出它属于谁——一个泄露的 `mcp_radar_` 值在
 * 事故里能省掉一轮"这是谁的凭据"。
 *
 * 结尾的下划线是分隔符，不是随机字符的一部分：prefix 固定 4 个 base64url 字符
 * （`randomBytes(3)` 的长度），所以 `readApiKeyPrefix` 能按位置切开而不必猜长度。
 */
export const API_KEY_PLAINTEXT_PREFIX = "mcp_radar_"

export function buildApiKeyPlaintext(prefix: string, secret: string): string {
  return `${API_KEY_PLAINTEXT_PREFIX}${prefix}_${secret}`
}

/**
 * 拆出展示用前缀，不是校验。
 *
 * 返回 `null` 表示这不是一个本系统签发的明文格式；调用方**不应**据此拒绝，
 * 因为前缀只是可读性设计，真正的验证是 `sha256(明文)` 查库——查不到就是查不
 * 到，与格式无关。
 *
 * 刻意不在这里检查长度或字符集：那只会把"格式看起来不对"和"key 无效"混成同
 * 一个错误码，而这两者对排障的含义完全不同。
 */
export function readApiKeyPrefix(plaintext: string): string | null {
  if (!plaintext.startsWith(API_KEY_PLAINTEXT_PREFIX)) return null
  const rest = plaintext.slice(API_KEY_PLAINTEXT_PREFIX.length)
  const separator = rest.indexOf("_")
  if (separator <= 0) return null
  return rest.slice(0, separator)
}