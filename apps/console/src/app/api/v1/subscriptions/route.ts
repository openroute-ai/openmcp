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