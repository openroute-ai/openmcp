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
  /**
   * 创建一个 project，也就是**把一个仓库发布到公开站**。
   *
   * 与 `repos:write` 分开，是因为两者写的是不同的表、可见的范围相差一个数量级：
   * `repos:write` 只写 `repos` / `user_repos`（"被知道、被跟踪"），
   * `projects:write` 写 `projects`（"被发布"）。
   *
   * 合并成一个 scope 就等于让每一个只想登记仓库的接入方同时拿到了发布权限，
   * 而发布权限本来只属于 `/dashboard/projects` 那条有人看过的 admin 路径。
   * 分开之后"能不能发布"是一个可以单独不给的、per-key 的开关。
   *
   * 刻意**不**进自助签发的默认子集（见 `SELF_SERVICE_SCOPES`）：发布是运营动作，
   * 不是用户对自己数据的操作。
   */
  "projects:write",
  /**
   * 执行 Skill 安全扫描（规则 + LLM 复核），并返回扫描文件与结论。
   *
   * 仅内部服务（Web → Console）使用，不开放自助签发。
   */
  "skills:scan",
] as const

export type ApiScope = (typeof API_SCOPES)[number]

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value)
}

/**
 * 配额档位。**不是权限** —— 权限只看 {@link ApiScope}。
 *
 * 把它做成一个字段而不是散在 `if (isAdmin(...))` 里，是因为自助签发需要一个可
 * 枚举的输入：管理员的表单要能列出两个取值，服务层要能强制两个约束，而这三个
 * 位置各写一份字面量数组就是三次漂移的机会。
 *
 * 语义是"有主人 ⇒ user，无主人 ⇒ service"：
 *
 * | tier | 谁签发 | `user_id` | 默认 rpm / rpd | 自助可勾选 |
 * |---|---|---|---|---|
 * | `user` | 用户自助，或 admin 代签发 | 非空 | 30 / 1000 | {@link SELF_SERVICE_SCOPES} |
 * | `service` | **仅** admin | **必须**为 `NULL` | 60 / 5000 | 全部 |
 *
 * 组合 `service` + 非空 `user_id` 是非法的，由 `assertTierMatchesOwner` 拒绝。
 * 理由见 `db/schema/api-keys.ts` 里 `tier` 的注释：允许它就会出现两套互相重叠
 * 的过滤维度（按 owner 查、按 tier 查），而交集语义说不清。
 */
export const API_TIERS = ["user", "service"] as const

export type ApiTier = (typeof API_TIERS)[number]

/** 每个 tier 的默认配额。**不是权限上限**，管理员可以改（`updateLimits`）。 */
export const TIER_DEFAULTS: Record<ApiTier, { rpm: number; rpd: number }> = {
  user: { rpm: 30, rpd: 1_000 },
  service: { rpm: 60, rpd: 5_000 },
}

/**
 * 自助签发时允许勾选的 scope。
 *
 * 三个都是"用户对自己数据的操作"，且不授予任何用户现在没有的能力：
 *
 * - `repos:read` / `rankings:read` 只读，没有副作用。
 * - `repos:write` 走的是 `upsertRepo` + `linkUserToRepo`，与已有的
 *   `repos.create`（`protectedProcedure`）同一条路；按 §1.4，提交**不会**发布。
 *
 * 刻意排除的三个：
 *
 * - `projects:write` —— 按 §1.4 它就是"把任意仓库推上公开站"的权限。
 * - `subscriptions:write` —— 等价于一个通用爬取原语：允许任意 `callbackUrl` +
 *   任意 filter（含 `includeUncurated: true`）。
 * - 任何未来的 scope —— 默认排除。要进自助范围必须先在这里显式加一行，
 *   这样"新 scope 忘了考虑自助"会是一次需要解决的 diff，而不是一个默认值。
 */
export const SELF_SERVICE_SCOPES = [
  "repos:read",
  "repos:write",
  "rankings:read",
] as const satisfies readonly ApiScope[]

export type SelfServiceScope = (typeof SELF_SERVICE_SCOPES)[number]

/** 自助入口是否接受这个 scope。admin 入口不看这个。 */
export function isSelfServiceScope(value: string): value is SelfServiceScope {
  return (SELF_SERVICE_SCOPES as readonly string[]).includes(value)
}

/**
 * 强制 `scopes` 是 `allowed` 的子集。
 *
 * **服务层调用，不信任 router 传进来的值。** 现有 `issueApiKey` /
 * `rotateApiKey` / `revokeApiKey` / `findApiKeyByPlaintext` 一行授权判断都没有，
 * 唯一的一道门在 router 里 —— 那是 admin-only 时代的形状（`adminProcedure` 之后
 * 还要什么？）。把 `createMine` 写成 `protectedProcedure` 会直接踩到它。
 *
 * 返回被拒的 scope 而不是抛错：调用方要能把"哪几个不合法"报给用户，而
 * `INVALID_SCOPE` 里带一个 `expected` 列表比带一个异常消息有用。
 */
export function assertScopesSubset(
  scopes: readonly string[],
  allowed: readonly string[]
): { ok: true } | { ok: false; rejected: string[] } {
  const permitted = new Set(allowed)
  const rejected = [...new Set(scopes.filter((scope) => !permitted.has(scope)))]
  return rejected.length > 0 ? { ok: false, rejected } : { ok: true }
}

/**
 * `tier` 与 `userId` 必须一致：有主人 ⇒ `user`，无主人 ⇒ `service`。
 *
 * 与 `assertScopesSubset` 同理，这是服务层的第二道形状检查。第一道管权限范围，
 * 这一道管**配额档位**，而档位决定默认配额和自助可勾选范围 —— 一个
 * `tier: "service"` 却带着主人��� key，等于让它拿到服务档配额却仍能被主人自助
 * 轮换，两个模型同时成立。
 */
export function assertTierMatchesOwner(
  tier: ApiTier,
  userId: string | null
): { ok: true } | { ok: false; message: string } {
  if (tier === "service" && userId !== null) {
    return {
      ok: false,
      message:
        'tier "service" 不能有主人：service key 是无主的接入方凭据。要替某用户签发，请传 tier: "user" 并指定 userId',
    }
  }
  if (tier === "user" && userId === null) {
    return {
      ok: false,
      message:
        'tier "user" 必须指定主人：自助签发的 key 永远有主人，由会话决定',
    }
  }
  return { ok: true }
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
