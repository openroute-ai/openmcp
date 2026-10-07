/**
 * Route A：把对 GitHub API 的请求整体转发到 `api.github.com`。
 *
 * 必须按原文回传 HTTP status、`x-ratelimit-*` 头与响应体——国内 console 的
 * `trackRateLimit()`（限流告警）与 `toGitHubError()`（按 status/headers 归类
 * 403/404/transport）依赖它们，剥掉任一项都会让降级/告警逻辑失真。转发只挑
 * 需要的头，不整包带（去掉上游无关的服务头）。
 */
import type { Context } from "hono"
import { githubTokens, egressSecret } from "../env"
import { TokenPool } from "./token-pool"

const GITHUB_API_ORIGIN = "https://api.github.com"

/**
 * The token pool is a module-level singleton so window records survive across
 * requests. A per-request pool would never "see" a rate-limit header it minted
 * in an earlier call, and the skip-exhausted-token logic would be dead code.
 *
 * The tokens are read lazily on construction from the environment; a singleton
 * cannot pick up a token added after startup, but the pool is re-created when
 * the token list grows (`ensureTokenPool`).
 */
let tokenPool: TokenPool | undefined

function ensureTokenPool(): TokenPool {
  const tokens = githubTokens()
  if (!tokenPool) {
    tokenPool = new TokenPool(tokens)
    return tokenPool
  }
  if (tokenPool.tokenCount() !== tokens.length) {
    tokenPool = new TokenPool(tokens)
  }
  return tokenPool
}

/** 回传给 console 的下游响应头：限流计数 + 内容协商。 */
const RESPONSE_HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
  "content-type",
  "link",
] as const

const RESPONSE_HEADER_SET = new Set<string>(RESPONSE_HEADERS)

class UnauthorizedError extends Error {
  readonly status = 401
}

function authorize(c: Context): void {
  const expected = egressSecret()
  const supplied = c.req.header("x-egress-secret")
  if (!expected || supplied !== expected) {
    throw new UnauthorizedError("invalid x-egress-secret")
  }
}

/**
 * REST 转发：`<origin>/api/github/rest/<path>?<query>` → `https://api.github.com/<path>?<query>`。
 *
 * 方法与请求体原样透传。上游的 `authorization` 用代理持有的 token 注入，绝不
 * 转发调用方可能带来的凭据。
 */
export async function forwardRestRequest(c: Context, path: string): Promise<Response> {
  authorize(c)

  const pool = ensureTokenPool()
  const token = pool.next()
  if (!token) {
    return c.json({ error: "no git token configured" }, 503)
  }

  const target = new URL(`${GITHUB_API_ORIGIN}/${path}`)
  target.search = new URL(c.req.url).search

  const headers = new Headers()
  for (const name of ["accept", "content-type", "if-none-match", "if-modified-since"]) {
    const value = c.req.header(name)
    if (value) headers.set(name, value)
  }
  headers.set("authorization", `token ${token}`)
  headers.set("user-agent", "openmcp-egress")

  const upstream = await fetch(target.toString(), {
    method: c.req.method,
    headers,
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.raw.body,
  })

  pool.record(token, upstream.headers)

  return selectResponseHeaders(upstream)
}

/** GraphQL 转发：POST `…/api/github/graphql` → `https://api.github.com/graphql`。 */
export async function forwardGraphqlRequest(c: Context): Promise<Response> {
  authorize(c)

  const pool = ensureTokenPool()
  const token = pool.next()
  if (!token) {
    return c.json({ error: "no git token configured" }, 503)
  }

  const headers = new Headers()
  for (const name of ["accept", "content-type"]) {
    const value = c.req.header(name)
    if (value) headers.set(name, value)
  }
  headers.set("authorization", `bearer ${token}`)
  headers.set("user-agent", "openmcp-egress")

  const body = await c.req.text()

  const upstream = await fetch(`${GITHUB_API_ORIGIN}/graphql`, {
    method: "POST",
    headers,
    body,
  })

  pool.record(token, upstream.headers)

  return selectResponseHeaders(upstream)
}

/** 只回传对 console 有意义的头 + 响应体。 */
function selectResponseHeaders(upstream: Response): Response {
  const headers = new Headers()
  for (const [name, value] of upstream.headers.entries()) {
    if (RESPONSE_HEADER_SET.has(name) || name.startsWith("x-ratelimit-")) {
      headers.set(name, value)
    }
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}