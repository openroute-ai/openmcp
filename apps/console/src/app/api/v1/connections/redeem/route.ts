/**
 * `POST /api/v1/connections/redeem` — 唯一**不需要凭据**的 `/api/v1` 端点（§2.11）。
 *
 * 它要发的东西就是凭据，所以这里没有任何 `authenticateApiKey`。替代的安全边界是
 * 一次性配对码 + 单 IP 限流，两者都在 `lib/api/connection-pairing.ts` 里。
 *
 * **关于那个码的错误一律 404，且四种失败原因给同一个答案**。分成不同的 code 等于给探测者
 * 一个二分枚举的 oracle：先试一串码，拿到"已过期"就知道它存在过。攻出一个存在的码就已经
 * 拿到了 API key，所以这里连"码存在但已用过"都不能区分。
 *
 * 两个例外（429 限流、403 配额）之所以能分开，是因为它们都在码通过全部校验**之后**才可能
 * 出现，泄漏的是"这个 IP 超频了"或"**码主人**的 key 存量满了"，而不是"这个码存在"。
 *
 * 响应恒为 `Cache-Control: no-store`：明文 key 在响应体里，缓存一份就等于多了一个
 * 能读到它的地方。
 */
import { NextResponse } from "next/server"
import { apiError } from "@/lib/api/guard"
import { pairingRedeemRequestSchema } from "@/lib/api/contract"
import { redeemPairing } from "@/lib/api/connection-pairing"

/** Reads and writes. */
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const headers: Record<string, string> = { "cache-control": "no-store" }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withNoStore(
      apiError(400, "invalid_body", "body is not valid JSON"),
      headers
    )
  }

  const parsed = pairingRedeemRequestSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return withNoStore(
      apiError(400, "invalid_body", "需要 { code, returnUrl }", {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
      headers
    )
  }

  const result = await redeemPairing({
    code: parsed.data.code,
    returnUrl: parsed.data.returnUrl,
    ip: clientIp(request),
  })

  if (!result.ok) {
    // 两个有区别的 code，都不泄漏关于那个码的信息：限流是纯本地计数，而配额只在
    // 码已经通过全部校验之后才可能出现（见 `RedeemErrorCode` 的注释）。客户端需要
    // 据此退避或去找账号主人处理，所以不能都压成 404。
    if (result.code === "rate_limited") {
      return withNoStore(
        apiError(429, "rate_limited", result.message, {
          headers: { "retry-after": "3600" },
        }),
        headers
      )
    }
    if (result.code === "quota_exceeded") {
      // 刻意**不带** `Retry-After`：这个上限要主人去 `/console/api-keys` 撤销一把 key
      // 才会动，60 秒之后它照样是 403。给一个不会兑现的重试时间，只会让客户端把它当成
      // 「退避一下就好」而空转。
      return withNoStore(apiError(403, "quota_exceeded", result.message), headers)
    }
    return withNoStore(apiError(404, "not_found", result.message), headers)
  }

  return withNoStore(
    NextResponse.json({
      ok: true,
      key: {
        id: result.keyId,
        name: result.name,
        scopes: result.scopes,
        tier: result.tier,
        /**
         * `mcp_radar_<prefix>_<secret>`。**只在这里出现一次**，之后任何接口都取不回来
         * —— 丢了就在 console 里轮换。
         */
        secret: result.secret,
      },
    }),
    headers
  )
}

function withNoStore(
  response: Response,
  extra: Record<string, string>
): Response {
  const merged = new Headers(response.headers)
  for (const [key, value] of Object.entries(extra)) merged.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

/** 倒序优先：`X-Forwarded-For` 的第一段是最原始的发起方。 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  if (first) return first
  return request.headers.get("x-real-ip")?.trim() || null
}
