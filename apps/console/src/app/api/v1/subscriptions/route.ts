/**
 * `/api/v1/subscriptions` — 列出或创建订阅。
 *
 * 归属主体是**当前这把 key**（`subscriptions.api_key_id`），不是它的归属人：console 用户
 * 在 `/console/subscriptions` 走会话 cookie 建自己的订阅，那条路径不经过这里。两者共用
 * `createSubscription` / `updateSubscription` / `deleteSubscription` 三个服务函数，而不
 * 共用 HTTP 层——把两种鉴权混进一个 handler 会让鉴权分支出现在每一行（§6.7）。
 *
 * 列出的是 `api_key_id = 当前 key`，没有别的过滤条件。**这就是租户隔离的全部实现**，
 * 所以 `GET /api/v1/subscriptions/{id}` 也一样：拿不到就是 404，不是 403。
 *
 * 创建被付费闸挡住（`POST` 在写库前检查 key 归属人有没有生效订阅）：控制台的
 * `subscriptions.create` 也拦，两扇门对同一件事，API 不是付费墙的漏洞。
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import {
  subscriptionCreatedSchema,
  subscriptionListSchema,
  subscriptionRequestSchema,
} from "@/lib/api/contract"
import {
  createSubscription,
  listSubscriptions,
  toSubscriptionView,
} from "@/lib/api/subscriptions"
import { getActiveSubscription } from "@/lib/billing/subscriptions"

/** Both methods read the database on every call. */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "subscriptions:write" })
  if (!auth.ok) return auth.response

  const subscriptions = await listSubscriptions(db, {
    apiKeyId: auth.principal.keyId,
  })

  return withRateLimitHeaders(
    NextResponse.json({
      subscriptions,
      count: subscriptions.length,
    } satisfies z.output<typeof subscriptionListSchema>),
    auth.rateLimitHeaders
  )
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, { scope: "subscriptions:write" })
  if (!auth.ok) return auth.response

  // 付费闸。鉴权主体是 key，但钱和权益挂在 key 的归属人身上，所以这里用
  // `principal.userId` 查一遍——否则付费墙在控制台拦住了、API 还能照建，等于没拦。
  // 与 tRPC `subscriptions.create` 是两扇门对同一件事，拒绝码也同源。
  const owner = auth.principal.userId
  const entitlement = owner ? await getActiveSubscription(owner) : null
  if (!entitlement) {
    return withRateLimitHeaders(
      apiError(
        403,
        "paid_entitlement_required",
        "creating a subscription requires an active paid plan"
      ),
      auth.rateLimitHeaders
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "body is not valid JSON"),
      auth.rateLimitHeaders
    )
  }

  const parsed = subscriptionRequestSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "订阅请求体不合法", {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
      auth.rateLimitHeaders
    )
  }

  const { row, signingKey } = await createSubscription(
    db,
    { apiKeyId: auth.principal.keyId },
    parsed.data
  )

  return withRateLimitHeaders(
    NextResponse.json(
      { ...toSubscriptionView(row), signingKey } satisfies z.output<
        typeof subscriptionCreatedSchema
      >,
      { status: 201 }
    ),
    auth.rateLimitHeaders
  )
}