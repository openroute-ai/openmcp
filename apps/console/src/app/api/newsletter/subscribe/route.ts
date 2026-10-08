/**
 * 订阅选型周刊。
 *
 * 落地页的「免费报告」表单本来只把邮箱记进组件状态就宣布成功——一个点了以后什么都
 * 不会发生的按钮。这个路由把邮箱真正落库，并立刻发一封确认邮件：邮件里带着报告对应
 * 的实时入口（飙升榜），这样「已订阅」不是一句空话。
 *
 * 匿名可调用：表单在公开落地页上，要求先注册会把每个还没注册的访客挡在门外。邮箱
 * 本身是身份，登录与否只决定要不要关联 `user_id`。
 */
import { NextResponse } from "next/server"

import { db } from "@/db/client"
import { newsletterSubscription } from "@/db/schema"
import { clientIpFromHeaders } from "@/lib/api/audit"
import { getApiRateLimiter } from "@/lib/api/rate-limit"
import { isMailConfigured, mailLocaleFrom, sendEmail } from "@/lib/mail"
import { unsubscribeUrl } from "@/lib/newsletter-token"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254

/**
 * 每个地址每小时的提交次数。
 *
 * 这个端点匿名、写库、还触发发信，之前一个闸门都没有：灌库之外，外发邮件的费用
 * 与发信域名信誉都由调用方决定。5 次/小时对真人绰绰有余（同一邮箱的重复提交本来
 * 就是 upsert），但把地址变成了有界的。
 *
 * IP 是从 `x-forwarded-for` 取的，与匿名 agent 面同一套信任假设：它是桶名而不是
 * 身份 —— 伪造它只能换一个桶花，总闸仍在。前提是反向代理覆写了这个头。
 */
const SUBSCRIBE_PER_HOUR = 5

/**
 * 允许出现的来源标记。
 *
 * 白名单而不是透传：这个值会被存下来、以后可能出现在邮件链接里，一个公开接口接受
 * 任意字符串就是在往下游存别人的输入。新增表单要带新来源时在这里加一个键。
 */
const SOURCES = new Set(["landing-report"])

export async function POST(request: Request) {
  // 闸门放在解析之前：伪造一个坏请求同样要花预算，而下面每一步都在写库或发信。
  const identity = clientIpFromHeaders(request.headers) ?? "unknown"
  const quota = await getApiRateLimiter().consume(
    `newsletter:${identity}`,
    SUBSCRIBE_PER_HOUR,
    3_600
  )
  if (!quota.allowed) {
    const retryAfter = quota.retryAfter ?? 60
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: retryAfter },
      { status: 429, headers: { "retry-after": String(retryAfter) } }
    )
  }

  let email: string
  let source: string | undefined
  try {
    const body = (await request.json()) as { email?: unknown; source?: unknown }
    email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    source =
      typeof body.source === "string" && SOURCES.has(body.source)
        ? body.source
        : undefined
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 })
  }

  // Upsert: a returning address re-subscribes rather than failing on the unique
  // index, and `onConflictDoUpdate` makes that atomic so two concurrent submits
  // cannot both miss the select and then collide on insert.
  await db
    .insert(newsletterSubscription)
    .values({
      id: crypto.randomUUID(),
      email,
      source,
    })
    .onConflictDoUpdate({
      target: newsletterSubscription.email,
      set: {
        subscribed: true,
        unsubscribedAt: null,
        updatedAt: new Date(),
        ...(source ? { source } : {}),
      },
    })

  // The address is recorded either way, so a missing transport must not turn the
  // submit into an error the reader can do nothing about — it is logged the same
  // way the verification code is, so a local run still sees the flow complete.
  const origin = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin
  const reportUrl = new URL("/rankings/rising", origin).toString()
  // Null only when `BETTER_AUTH_SECRET` is unset, which better-auth itself
  // requires; the mail then goes out without a footer link rather than with one
  // nobody can verify.
  const unsubscribe = unsubscribeUrl(email, origin)
  if (!unsubscribe) {
    console.warn(
      "[console] BETTER_AUTH_SECRET is unset; newsletter welcome has no unsubscribe link"
    )
  }

  if (isMailConfigured()) {
    try {
      await sendEmail({
        to: email,
        template: "subscribeNewsletter",
        locale: mailLocaleFrom(request),
        context: { url: reportUrl, ...(unsubscribe ? { unsubscribeUrl } : {}) },
      })
    } catch (error) {
      console.error("[console] newsletter welcome send failed:", error)
    }
  } else {
    console.warn(`[mail:test] newsletter welcome for ${email}: ${reportUrl}`)
  }

  return NextResponse.json({ ok: true })
}
