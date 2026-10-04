/**
 * `/api/v1/subscriptions/{id}` — 读、改、删一条订阅。
 *
 * 三个方法都带归属过滤，所以「不是你的」与「不存在」返回同一个 404。这是 §6.7 的
 * 「租户隔离的全部实现」：不存在的第二道检查一旦漏掉，别人就能改你的回调地址。
 *
 * `PATCH` 的副作用在服务层（`updateSubscription`）：命中任何过滤字段时 `filtersVersion`
 * 加一，并把水位线**回退**到新命中集合的最早已存周期（§6.4）。响应里两个值都会变，
 * 调用方能自己确认这次改动被记住了。
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
  subscriptionDetailSchema,
  subscriptionUpdateSchema,
} from "@/lib/api/contract"
import {
  deleteSubscription,
  getSubscriptionDetail,
  toSubscriptionView,
  updateSubscription,
} from "@/lib/api/subscriptions"

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Context) {
  const auth = await authenticateApiKey(request, { scope: "subscriptions:write" })
  if (!auth.ok) return auth.response

  const { id } = await params
  const owner = { apiKeyId: auth.principal.keyId }

  const detail = await getSubscriptionDetail(db, owner, id)
  if (!detail) return notFound(auth.rateLimitHeaders)

  return withRateLimitHeaders(
    NextResponse.json(detail satisfies z.output<typeof subscriptionDetailSchema>),
    auth.rateLimitHeaders
  )
}

export async function PATCH(request: Request, { params }: Context) {
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

  const parsed = subscriptionUpdateSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return withRateLimitHeaders(
      apiError(400, "invalid_body", "更新请求体不合法", {
        detail: issue
          ? `${issue.path.join(".") || "(body)"}: ${issue.message}`
          : undefined,
      }),
      auth.rateLimitHeaders
    )
  }

  const { id } = await params
  const owner = { apiKeyId: auth.principal.keyId }

  const updated = await updateSubscription(db, owner, id, parsed.data)
  if (!updated) return notFound(auth.rateLimitHeaders)

  return withRateLimitHeaders(
    NextResponse.json(toSubscriptionView(updated)),
    auth.rateLimitHeaders
  )
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await authenticateApiKey(request, { scope: "subscriptions:write" })
  if (!auth.ok) return auth.response

  const { id } = await params
  const removed = await deleteSubscription(db, { apiKeyId: auth.principal.keyId }, id)
  if (!removed) return notFound(auth.rateLimitHeaders)

  // 队列随 `webhook_deliveries.subscription_id` 的 CASCADE 一起消失，所以取消订阅之后
  // 不会有任何残留的重试再打出去。
  return withRateLimitHeaders(
    NextResponse.json({ ok: true, id } as const),
    auth.rateLimitHeaders
  )
}

function notFound(headers: Record<string, string>): Response {
  return withRateLimitHeaders(
    apiError(404, "not_found", "订阅不存在"),
    headers
  )
}