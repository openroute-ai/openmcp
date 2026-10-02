/**
 * 退订选型周刊。
 *
 * 邮件里的链接是 GET：收件人点开就该看到结果，不该要求先登录或再点一次确认。
 * 身份由签名 token 证明（见 `@/lib/newsletter-token`），所以这个接口可以公开，
 * 而不会变成「给个邮箱就能退订别人」的漏洞。
 *
 * 幂等：地址不在库里、或已经退订，都算成功——收件人关心的是「我不再收到」，
 * 链接重复点开不该报错。
 */
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { db } from "@/db/client"
import { newsletterSubscription } from "@/db/schema"
import { mailLocaleFrom } from "@/lib/mail"
import { normalizeEmail, verifyUnsubscribeToken } from "@/lib/newsletter-token"

export const dynamic = "force-dynamic"

const COPY = {
  zh: {
    okTitle: "已退订",
    okBody: "你已退订 OpenMCP 选型周刊，不会再收到周刊邮件。",
    badTitle: "链接无效",
    badBody: "这个退订链接无效或已损坏，请从邮件里重新打开。",
    home: "返回首页",
  },
  en: {
    okTitle: "Unsubscribed",
    okBody: "You have been unsubscribed from the OpenMCP weekly and will not receive it again.",
    badTitle: "Invalid link",
    badBody: "This unsubscribe link is invalid or damaged. Please reopen it from the email.",
    home: "Back to home",
  },
} as const

function page(locale: string, ok: boolean): string {
  const copy = COPY[locale === "en" ? "en" : "zh"]
  const title = ok ? copy.okTitle : copy.badTitle
  const body = ok ? copy.okBody : copy.badBody
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "zh"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: #f5f5f5; color: #111; }
main { max-width: 26rem; padding: 2.5rem; text-align: center; background: #fff;
  border: 1px solid #e5e5e5; border-radius: 1rem; }
h1 { margin: 0 0 0.75rem; font-size: 1.25rem; }
p { margin: 0 0 1.5rem; font-size: 0.9rem; line-height: 1.6; color: #555; }
a { color: #111; font-size: 0.9rem; }
@media (prefers-color-scheme: dark) {
  body { background: #0a0a0a; color: #fafafa; }
  main { background: #171717; border-color: #262626; }
  p { color: #a3a3a3; }
  a { color: #fafafa; }
}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${body}</p>
<a href="/">${copy.home}</a>
</main>
</body>
</html>`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const email = normalizeEmail(url.searchParams.get("email") ?? "")
  const token = url.searchParams.get("token") ?? ""
  const locale = mailLocaleFrom(request)
  const valid = email !== "" && verifyUnsubscribeToken(email, token)

  if (valid) {
    await db
      .update(newsletterSubscription)
      .set({
        subscribed: false,
        unsubscribedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(newsletterSubscription.email, email))
  }

  return new NextResponse(page(locale, valid), {
    status: valid ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}
