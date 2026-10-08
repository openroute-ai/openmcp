/**
 * Route A：把对 GitHub API 的请求整体转发到 `api.github.com`。
 *
 * 必须按原文回传 HTTP status、`x-ratelimit-*` 头与响应体——国内 console 的
 * `trackRateLimit()`（限流告警）与 `toGitHubError()`（按 status/headers 归类
 * 403/404/transport）依赖它们，剥掉任一项都会让降级/告警逻辑失真。转发只挑
 * 需要的头，不整包带（去掉上游无关的服务头）。
 *
 * 请求体是缓冲后转发而不是流式透传：把 `c.req.raw.body` 直接交给 `fetch` 需要
 * `duplex: "half"`，而 Vercel 的运行时对 stream body 的处理并不稳定。上限由
 * `egressMaxRequestBodyBytes()` 决定（默认 1 MiB），超限 413——GitHub API 自己
 * 也只会接受远小于这个体积的请求体，限制不损失任何合法调用。
 */
import type { Context } from "hono"
import {
  egressForwardTimeoutMs,
  egressMaxRequestBodyBytes,
  githubTokens,
} from "../env"
import { requireEgressSecret } from "./authz"
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

/** 请求体过大（`EGRESS_MAX_REQUEST_BODY_BYTES`）。该类错误有 status，onError 按它回 413。 */
class PayloadTooLargeError extends Error {
  readonly status = 413
}

/**
 * REST 转发：`<origin>/api/github/rest/<path>?<query>` → `https://api.github.com/<path>?<query>`。
 *
 * 方法与请求体原样透传。上游的 `authorization` 用代理持有的 token 注入，绝不
 * 转发调用方可能带来的凭据。
 */
export async function forwardRestRequest(
  c: Context,
  path: string
): Promise<Response> {
  const unauthorized = requireEgressSecret(c)
  if (unauthorized) return unauthorized

  const pool = ensureTokenPool()
  const token = pool.next()
  if (!token) {
    return c.json({ error: "no git token configured" }, 503)
  }

  const target = new URL(`${GITHUB_API_ORIGIN}/${path}`)
  target.search = new URL(c.req.url).search

  const headers = new Headers()
  for (const name of [
    "accept",
    "content-type",
    "if-none-match",
    "if-modified-since",
  ]) {
    const value = c.req.header(name)
    if (value) headers.set(name, value)
  }
  headers.set("authorization", `token ${token}`)
  headers.set("user-agent", "openmcp-egress")

  const upstream = await forwardUpstream(c, async () => {
    const body = await requestBody(c)
    return fetch(target.toString(), {
      method: c.req.method,
      headers,
      body,
      signal: AbortSignal.timeout(egressForwardTimeoutMs()),
    })
  })

  pool.record(token, upstream.headers)

  return selectResponseHeaders(upstream, c.req.method)
}

/** GraphQL 转发：POST `…/api/github/graphql` → `https://api.github.com/graphql`。 */
export async function forwardGraphqlRequest(c: Context): Promise<Response> {
  const unauthorized = requireEgressSecret(c)
  if (unauthorized) return unauthorized

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

  const upstream = await forwardUpstream(c, async () => {
    const body = await requestBody(c)
    return fetch(`${GITHUB_API_ORIGIN}/graphql`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(egressForwardTimeoutMs()),
    })
  })

  pool.record(token, upstream.headers)

  return selectResponseHeaders(upstream, "POST")
}

/**
 * 读取并缓冲请求体。GET/HEAD 不读体；空体转成 `undefined`，避免给 `fetch`
 * 一个零长 ArrayBuffer 被当成"有体"处理。
 *
 * `content-length` 预检只是省一次完整读取；真正的闸门是读完后的 `byteLength`
 * 比较——`fetch` 基础设施不保证调用方声明的长度就是实际长度。
 */
async function requestBody(c: Context): Promise<Uint8Array | undefined> {
  const method = c.req.method
  if (method === "GET" || method === "HEAD") return undefined

  const limit = egressMaxRequestBodyBytes()
  const contentLength = c.req.header("content-length")
  if (contentLength !== null && Number(contentLength) > limit) {
    throw new PayloadTooLargeError(
      "request body exceeds EGRESS_MAX_REQUEST_BODY_BYTES"
    )
  }

  return readBody(c.req.raw.body, limit)
}

async function readBody(
  body: ReadableStream | null,
  limit: number
): Promise<Uint8Array | undefined> {
  const buffered = await new Response(body ?? null).arrayBuffer()
  if (buffered.byteLength === 0) return undefined
  if (buffered.byteLength > limit) {
    throw new PayloadTooLargeError(
      "request body exceeds EGRESS_MAX_REQUEST_BODY_BYTES"
    )
  }
  return new Uint8Array(buffered)
}

/**
 * 执行上游请求并把超时翻译成 504。`AbortSignal.timeout` 以 `TimeoutError`
 * 拒绝；把它当成 500 会让 console 把一次上游变慢误判成代理内部故障。
 */
async function forwardUpstream(
  c: Context,
  run: () => Promise<Response>
): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return c.json(
        { error: "upstream_timeout", message: "upstream request timed out" },
        504
      )
    }
    throw error
  }
}

/** 只回传对 console 有意义的头 + 响应体。 */
function selectResponseHeaders(upstream: Response, method: string): Response {
  const headers = new Headers()
  for (const [name, value] of upstream.headers.entries()) {
    if (RESPONSE_HEADER_SET.has(name) || name.startsWith("x-ratelimit-")) {
      headers.set(name, value)
    }
  }

  // 语义上没有 body 的响应显式置 null：`new Response(upstream.body)` 会把手放在
  // 一个既不会流数据也不会结束的 body 上，Vercel 函数在响应完成前不释放实例。
  const bodyless =
    method === "HEAD" ||
    upstream.status === 101 ||
    upstream.status === 204 ||
    upstream.status === 304

  return new Response(bodyless ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}
