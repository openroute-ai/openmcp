/**
 * `/api/v1/subscriptions/{id}/rotate-secret` — 换一把签名密钥。
 *
 * 旧密钥**立刻**失效：服务层只覆盖 `secret_hash` 一列，没有宽限期（§6.2）。轮换的典型
 * 动机是「密钥疑似泄露」，而那要求的是立刻，不是「等下一次投递自然过渡」。
 *
 * 新明文同样只此一次。没有它就给 `POST /api/v1/subscriptions/{id}/test` 验签——测试事件
 * 与正常事件走**完全**一样的签名路径，所以它能验签通过就说明新密钥配好了（§6.8）。
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/db/client"
import {
  apiError,
  authenticateApiKey,
  withRateLimitHeaders,
} from "@/lib/api/guard"
import { subscriptionRotatedSchema } from "@/lib/api/contract"
import { rotateSubscriptionSecret } from "@/lib/api/subscriptions"

/** Reads the database on every call. */
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request, { scope: "subscriptions:write" })
  if (!auth.ok) return auth.response

  const { id } = await params
  const rotated = await rotateSubscriptionSecret(db, {
    apiKeyId: auth.principal.keyId,
  }, id)

  if (!rotated) {
    return withRateLimitHeaders(
      apiError(404, "not_found", "订阅不存在"),
      auth.rateLimitHeaders
    )
  }

  return withRateLimitHeaders(
    NextResponse.json(rotated satisfies z.output<typeof subscriptionRotatedSchema>),
    auth.rateLimitHeaders
  )
}
