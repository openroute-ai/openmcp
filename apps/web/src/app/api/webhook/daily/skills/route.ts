/**
 * Inbound Skills webhook from apps/console.
 *
 * Contract: POST body is `SkillWebhookPayload` (`event_type: skill_updated`).
 * Console also sends its write-callbacks (`repo.registered` / `repo.published`)
 * to this same address; those are acknowledged, not ingested — see the handler.
 *
 * Auth, in the order it is tried:
 *   1. console's HMAC signature, over `<timestamp>.<body>`, with
 *      `CONSOLE_SKILLS_CALLBACK_SECRET`. This is what it sends now: the
 *      destination and its key are per-submitter and travel on the
 *      `POST /api/v1/projects` call that registered the repository, because
 *      console has no deployment-wide skills endpoint.
 *   2. a plain bearer matching `WEB_SKILLS_INGEST_TOKEN|SKILLS_WEBHOOK_TOKEN`, so
 *      a console that predates per-submitter callbacks still works.
 *
 * Fails closed with 404 when neither credential is configured.
 *
 * Console side, when it registers a repository through the API:
 *   callbackUrl=https://<this-host>/api/webhook/daily/skills
 *   callbackSecret=<CONSOLE_SKILLS_CALLBACK_SECRET>
 *
 * Optional pull (same payload shape), which authorises the other direction —
 * this app reading console's export with `SKILLS_WEBHOOK_TOKEN`:
 *   curl -H "Authorization: Bearer $SKILLS_WEBHOOK_TOKEN" \
 *     "$CONSOLE_URL/api/skills-sync/export?limit=100"
 */

import { type NextRequest, NextResponse } from 'next/server'
import {
  ingestConsoleSkill,
  isConsoleWriteCallback,
  validateSkillWebhookPayload,
} from '@/lib/skills/ingest-console-skill'
import { assertSkillsWebhookAuthorized } from '@/lib/webhook/bearer-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Read once as text: the signature covers these exact bytes, so verifying it
  // against a re-serialised object would reject every genuine request.
  const rawBody = await request.text()

  const unauthorized = assertSkillsWebhookAuthorized(request, rawBody)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // console 把 `repo.registered` / `repo.published` 也发到这个地址：它在
  // `POST /api/v1/projects` 上把这个 URL 当作"该提交方的回调地址"，而技能投递
  // 与写端点通知共用它。把它们当技能文档校验会得到一个 `invalid event_type` 的
  // 400，console 于是把一次发布成功的调用记成 `callback failed` —— 技能其实已经
  // 推到了，唯一的症状是一条指向本路由的假报警。
  //
  // 认证已经在上面过了，而这份报文不带任何可落库的数据：它说的是"project 现在可以
  // 被读了"，可读的数据在 console 自己的库里。所以确认收到即可，不写库。
  if (isConsoleWriteCallback(body)) {
    return NextResponse.json({ ok: true, event: body.event, fullName: body.fullName, ingested: false })
  }

  const validated = validateSkillWebhookPayload(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  try {
    const result = await ingestConsoleSkill(validated.payload.data)
    return NextResponse.json({
      ok: true,
      id: result.id,
      referenceId: result.referenceId,
      slug: result.slug,
      created: result.created,
      status: result.status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[webhook/daily/skills]', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
