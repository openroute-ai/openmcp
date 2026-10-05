/**
 * `/api/v1` 的鉴权入口。
 *
 * 这里和 console 自己的会话是两条互不相干的路径：`adminProcedure` 走
 * better-auth 的 cookie，`/api/v1` 走 `Authorization: Bearer`。共用一套鉴权会
 * 让"谁能给自己发 key"和"谁能读排行"变成同一个问题，而它们必须分开。
 *
 * 一个刻意的设计：**查不到 key 返回 404，不是 401**。与 `lib/cron/guard.ts`
 * 的 fail-closed 行为一致——一个没配凭据的实例不该通过状态码差别告诉探测者这条
 * 路由存在。"没有这个 key"和"这条路由不存在"对攻击者是同一件事。
 */
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { apiKeys } from "@/db/schema/api-keys"
import {
  findApiKeyByPlaintext,
  hashApiKey,
  normalizeScopes,
  touchApiKeyUsage,
} from "./keys"
import { getApiRateLimiter } from "./rate-limit"
import type { ApiScope, ApiTier } from "./scopes"

export type ApiKeyPrincipal = {
  keyId: string
  scopes: ReadonlySet<ApiScope>
  /** 这把 key 提交仓库时 `user_repos` 记谁。见 `apiKeys.submitterId`。 */
  submitterId: string | null
  /**
   * 归属人。service key 为 `null`。
   *
   * 加进来的原因不是"页面要显示它"，而是 §2.12：审计记录里的 `user_id` 必须来自
   * **鉴权时**的这一行，而不是任何请求参数。一把无主的 key 调用时写进去的
   * `user_id` 是 `null`，而有主的 key 无论调用方怎么自称都只会记它的主人。
   */
  userId: string | null
  tier: ApiTier
  /**
   * `sha256(明文)`。
   *
   * 鉴权已经算过一次这个值（按它查库），而 `Idempotency-Key` 的回放表以它作为主键的
   * 一半。让路由再 `hashApiKey(plaintext)` 一次是重复计算，而更糟的是它要求路由能拿到
   * 明文——那会让"凭据只经过 guard 一次"这个性质失效。
   */
  keyHash: string
}

export type AuthFailure = {
  ok: false
  response: Response
}

export type AuthSuccess = {
  ok: true
  principal: ApiKeyPrincipal
  /** 由 guard 附加到响应上的限流头；调用方决定是否真的用上。 */
  rateLimitHeaders: Record<string, string>
}

/** 客户端可以据此判断该重试还是改代码。 */
const JSON_ERROR_CONTENT_TYPE = "application/json; charset=utf-8"

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: { headers?: Record<string, string>; detail?: string } = {}
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(extra.detail ? { detail: extra.detail } : {}),
      },
    },
    {
      status,
      headers: { "content-type": JSON_ERROR_CONTENT_TYPE, ...extra.headers },
    }
  )
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  // RFC 6750 的 scheme 大小写不敏感。
  const match = /^bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * 每分钟 + 每日两道窗口。
 *
 * 每日窗口用 UTC 日界，与 GitHub 额度的口径一致——这样"我今天还能用多少次"在
 * console 和 GitHub 两边是同一个数。一个 key 可以配不同的 rpm/rpd，因为限流
 * 保护的是下游：`rankings:read` 很便宜而 `POST /repos` 会触发一次 GitHub 抓取，
 * 两者的安全上限差一个数量级。
 *
 * 分钟窗口先查：它更常触发，报 `Retry-After` 的秒数也更小，对排障有用。
 */
export async function consumeRateLimit(
  keyId: string,
  limits: { rpm: number; rpd: number }
): Promise<{ headers: Record<string, string>; failure?: Response }> {
  const limiter = getApiRateLimiter()

  const perMinute = await limiter.consume(`k:${keyId}`, limits.rpm, 60)
  if (!perMinute.allowed) {
    return {
      headers: rateLimitHeaders(perMinute),
      failure: apiError(429, "rate_limited", "每分钟请求数超限", {
        headers: {
          ...rateLimitHeaders(perMinute),
          "retry-after": String(perMinute.retryAfter ?? 60),
        },
      }),
    }
  }

  // 一天里的秒数取自 UTC，与每日窗口的日界同一个时钟。
  const secondsIntoUtcDay = Math.floor(Date.now() / 1000) % (24 * 60 * 60)
  const secondsUntilUtcMidnight = 24 * 60 * 60 - secondsIntoUtcDay

  const perDay = await limiter.consume(
    `d:${keyId}`,
    limits.rpd,
    Math.max(1, secondsUntilUtcMidnight)
  )
  if (!perDay.allowed) {
    return {
      headers: rateLimitHeaders(perDay),
      failure: apiError(429, "rate_limited", "每日请求数超限", {
        headers: {
          ...rateLimitHeaders(perDay),
          "retry-after": String(perDay.retryAfter ?? secondsUntilUtcMidnight),
        },
      }),
    }
  }

  // 两道窗口都过了，报更紧的那一道。
  const tightest = perMinute.remaining <= perDay.remaining ? perMinute : perDay
  return { headers: rateLimitHeaders(tightest) }
}

function rateLimitHeaders(result: {
  limit: number
  remaining: number
  resetAt: number
}): Record<string, string> {
  return {
    "ratelimit-limit": String(result.limit),
    "ratelimit-remaining": String(result.remaining),
    "ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  }
}

export type AuthenticateOptions = {
  /** 本次请求需要的 scope。缺省表示任何已认证的 key 都放行。 */
  scope?: ApiScope
  /** `keyHash` 查库；测试里换掉。 */
  lookup?: typeof findApiKeyByPlaintext
}

/**
 * 顺序：取 Bearer → 查库 → 吊销 → 过期 → scope → 限流 → 记录使用。
 *
 * 任何一步失败立即返回，不再往下查：尤其是限流放在最后，因为对一个已经吊销的
 * key 计一次配额没有意义。
 */
export async function authenticateApiKey(
  request: Request,
  options: AuthenticateOptions = {}
): Promise<AuthSuccess | AuthFailure> {
  const token = readBearerToken(request)
  if (!token) {
    return {
      ok: false,
      response: apiError(
        401,
        "missing_credentials",
        "缺少 Authorization: Bearer <key>",
        { headers: { "www-authenticate": 'Bearer realm="mcp-radar"' } }
      ),
    }
  }

  const lookup = options.lookup ?? findApiKeyByPlaintext
  const row = await lookup(db, token)
  // 与 `findApiKeyByPlaintext` 内部用的是同一个函数，所以这里必然等于库里那一行。
  const keyHash = hashApiKey(token)
  if (!row) {
    // 见文件头：404 而非 401，理由是状态码差别不应泄漏路由是否存在。
    return {
      ok: false,
      response: apiError(404, "not_found", "not found"),
    }
  }

  if (row.revokedAt) {
    return {
      ok: false,
      response: apiError(401, "key_revoked", "这把 key 已被吊销", {
        headers: { "www-authenticate": 'Bearer error="invalid_token"' },
      }),
    }
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      response: apiError(401, "key_expired", "这把 key 已过期", {
        headers: { "www-authenticate": 'Bearer error="invalid_token"' },
      }),
    }
  }

  const scopes = new Set(normalizeScopes(row.scopes))
  if (options.scope && !scopes.has(options.scope)) {
    return {
      ok: false,
      response: apiError(
        403,
        "insufficient_scope",
        `需要 ${options.scope} 权限`,
        {
          headers: {
            "www-authenticate": `Bearer error="insufficient_scope", scope="${options.scope}"`,
          },
          detail: `这把 key 持有: ${[...scopes].join(", ") || "（无）"}`,
        }
      ),
    }
  }

  const rateLimited = await consumeRateLimit(row.id, {
    rpm: row.rateLimitRpm,
    rpd: row.rateLimitRpd,
  })
  if (rateLimited.failure) {
    return { ok: false, response: rateLimited.failure }
  }

  // 不 await：这一列是"还在用吗"的答案，不是审计，丢一次不影响正确性。
  void touchApiKeyUsage(db, row.id)

  return {
    ok: true,
    principal: {
      keyId: row.id,
      scopes,
      submitterId: row.submitterId,
      userId: row.userId,
      tier: row.tier,
      keyHash,
    },
    rateLimitHeaders: rateLimited.headers,
  }
}

/**
 * 读 key 的独立查询，供 `/dashboard` 之类的管理界面用。
 *
 * 与鉴权分开，因为这里**不**做吊销/过期判定——一个管理界面需要看见已吊销的
 * key 才能解释"它为什么不见了"。漏了这个区别，最有用的那部分记录反而看不见。
 */
export async function listKeys(
  options: { onlyActive?: boolean; userId?: string } = {}
) {
  // `userId` 在 SQL 里过滤，不在拿到行之后过滤。后者对 `/console` 的功能没影响，
  // 但它是"只显示我自己的"这种按钮最常见的实现错误：过滤写对了，可它发生在一个
  // 已经把全站 key 都读进内存的查询之后，一次 N+1 或一个过量响应体就把它废掉了。
  const filters = [
    ...(options.onlyActive
      ? [
          and(
            isNull(apiKeys.revokedAt),
            or(isNull(apiKeys.expiresAt), sql`${apiKeys.expiresAt} > now()`)
          ),
        ]
      : []),
    ...(options.userId ? [eq(apiKeys.userId, options.userId)] : []),
  ]

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      userId: apiKeys.userId,
      tier: apiKeys.tier,
      createdBy: apiKeys.createdBy,
      submitterId: apiKeys.submitterId,
      rateLimitRpm: apiKeys.rateLimitRpm,
      rateLimitRpd: apiKeys.rateLimitRpd,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      revokedReason: apiKeys.revokedReason,
      lastUsedAt: apiKeys.lastUsedAt,
      lastRotatedAt: apiKeys.lastRotatedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(sql`${apiKeys.createdAt} DESC`)

  return rows.map((row) => ({ ...row, scopes: normalizeScopes(row.scopes) }))
}

/** 把 guard 的结果摊到一个响应上，附上限流头。 */
export function withRateLimitHeaders(
  response: Response,
  headers: Record<string, string>
): Response {
  const merged = new Headers(response.headers)
  for (const [key, value] of Object.entries(headers)) merged.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}
