/**
 * `GET /api/v1/openapi.json` — 这份契约本身，**需要有效凭据**。
 *
 * 加这道门不是为了藏住什么：同一个部署还有一份免鉴权的副本在 `/openapi.json`，文档
 * 页面与 `llms.txt` 指向的就是它，而这里的 spec 与它同源，都是
 * `lib/openapi/document.ts` 聚出来的。加门是为了**不把它当成免费的接口发现服务** ——
 * 一个任何人都能匿名拉走的接口清单，是给扫描器准备的目标清单。
 *
 * **任何有效 key 都放行**，不要求某个 scope：这份文档不返回任何数据，自描述端点自己
 * 才是要鉴权的那一部分。因此 `authenticateApiKey` 不传 `scope`，由它负责 Bearer 解析、
 * 吊销、过期与限流。
 *
 * 不缓存成 `force-static`：鉴权结果与限流头每次都要算，而 spec 本体由 `ETag` 保证
 * 条件请求不会重新下载。
 */
import { createHash } from "node:crypto"
import {
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { buildOpenAPIDocument } from "@/lib/openapi/document"

/** Every call authenticates, so nothing here may be served from a cache. */
export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request)
  if (!auth.ok) return auth.response

  const body = buildOpenAPIDocument()

  // 无条件响应 = 无法条件请求 = 每次都重下整份 spec。spec 是随代码变的东西，
  // 而它自己也可能是排查"为什么这个端点不在文档里"的第一个请求，所以给一个弱 ETag：
  // 内容没变就 304，变了就重下。
  const etag = `W/"${hash(JSON.stringify(body))}"`

  if (request.headers.get("if-none-match") === etag) {
    return withRateLimitHeaders(
      new Response(null, { status: 304, headers: { ETag: etag } }),
      auth.rateLimitHeaders
    )
  }

  return withRateLimitHeaders(
    Response.json(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        ETag: etag,
      },
    }),
    auth.rateLimitHeaders
  )
}

/**
 * 内容指纹。
 *
 * 弱 ETag 是对的选择：这份文档确实会随部署变，但它的**语义**只有一次生成——从同一个
 * `buildOpenAPIDocument()` 出来的东西按字节逐字相同，所以强比较（`W/` 的反面）只会
 * 多花一次哈希。
 */
function hash(payload: string): string {
  return createHash("sha256").update(payload).digest("base64url")
}