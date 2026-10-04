/**
 * `/api/v1/subscriptions/{id}/test` — 发一条探测事件。
 *
 * 用途是**改过滤器之后立刻知道对不对**（§6.8）：地址可达吗、签名过吗、按我想的过滤器
 * 命中了吗。payload 里是一份真实的当前快照（取前 5 个仓库），所以它也回答第三个问题。
 *
 * **不推进水位线**：它是探测，不是补数据。推进了会让下一次正常投递从探测那一刻算起，
 * 于是「探测一下」这个只读动作把增量数据吞掉了一段。
 *
 * 同步等待、有超时。异步 fire-and-forget 会让「回调地址写错」这件事永远不被发现，而这
 * 正是这个端点存在的理由。
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { subscriptionTestSchema } from "@/lib/api/contract"
import { getSubscription } from "@/lib/api/subscriptions"
import { sendTestDelivery } from "@/lib/api/subscription-delivery"

/** Reaches the subscriber's endpoint, so it can outlive the default budget. */
export const maxDuration = 60

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request, { scope: "subscriptions:write" })
  if (!auth.ok) return auth.response

  const { id } = await params
  const owner = { apiKeyId: auth.principal.keyId }

  const subscription = await getSubscription(db, owner, id)
  if (!subscription) {
    return withRateLimitHeaders(
      apiError(404, "not_found", "订阅不存在"),
      auth.rateLimitHeaders
    )
  }

  const now = new Date()
  const result = await sendTestDelivery(db, subscription, now, consoleLogger)

  // 投递失败报 502 而不是 4xx：请求本身合法，是**对方**的端点没接住。消费方据此区分
  // 「我调错了」与「我的回调坏了」，而后者才是这个端点要回答的问题。
  return withRateLimitHeaders(
    NextResponse.json(
      { id: subscription.id, ...result } satisfies z.output<
        typeof subscriptionTestSchema
      >,
      { status: result.delivered ? 200 : 502 }
    ),
    auth.rateLimitHeaders
  )
}

/** 探测投递走日志而不是任务的 `logger`：它是一次 HTTP 调用，不是一次任务运行。 */
const consoleLogger = {
  info: (message: string, meta?: Record<string, unknown>) =>
    console.info(message, meta ?? {}),
  warn: (message: string, meta?: Record<string, unknown>) =>
    console.warn(message, meta ?? {}),
  error: (message: string, meta?: Record<string, unknown>) =>
    console.error(message, meta ?? {}),
}
