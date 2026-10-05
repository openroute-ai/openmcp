/**
 * console → web 回调路由的事件分流。
 *
 * 这里复现的是一条真实故障：`POST /api/webhook/daily/skills` 同时是技能投递的
 * 地址和 console 写端点回调的地址（console 在 `POST /api/v1/projects` 上把它当作
 * "该提交方的回调地址"）。路由只认 `skill_updated`，于是每次登记/发布都会收到
 * 一个 `invalid event_type` 的 400，console 把一次已经成功的发布记成
 * `callback failed` —— 而技能其实已经推到了，唯一的症状是一条指向本路由的假报警。
 *
 * 所以断言的是**状态码**：写端点回调必须是 200，而且不落库 —— 落库只有
 * `ingestConsoleSkill` 一条路径，它只能由技能投递触发。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { NextRequest } from "next/server"
import { POST } from "@/app/api/webhook/daily/skills/route"
import { isConsoleWriteCallback } from "@/lib/skills/ingest-console-skill"
import { signPayload } from "@/lib/webhook/signature"

const SECRET = "per-submitter-callback-secret"

/** console 的 `deliverWriteCallback` 发的就是这形状。 */
const WRITE_CALLBACK = {
  eventId: "repo.published.repo_123",
  event: "repo.published",
  occurredAt: new Date().toISOString(),
  fullName: "vercel-labs/open-agents",
  repoId: "repo_123",
  created: true,
  projectId: "prj_123",
}

/** console 的技能投递，故意缺 `name`，好在校验阶段停下而不落库。 */
const SKILL_DELIVERY = {
  event_type: "skill_updated",
  timestamp: new Date().toISOString(),
  data: {
    repo_full_name: "acme/pdf",
    repo_name: "pdf",
    repo_owner: "acme",
    skill_dir: ".agents/skills/pdf",
  },
}

/** console 用同一个签名格式覆盖它发送的字节。 */
function signed(body: string): NextRequest {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new Request("http://localhost/api/webhook/daily/skills", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signPayload(body, timestamp, SECRET),
    },
    body,
  }) as NextRequest
}

describe("POST /api/webhook/daily/skills event routing", () => {
  let savedCallback: string | undefined
  let savedIngest: string | undefined

  beforeEach(() => {
    savedCallback = process.env.CONSOLE_SKILLS_CALLBACK_SECRET
    savedIngest = process.env.WEB_SKILLS_INGEST_TOKEN
    process.env.CONSOLE_SKILLS_CALLBACK_SECRET = SECRET
    delete process.env.WEB_SKILLS_INGEST_TOKEN
  })

  afterEach(() => {
    if (savedCallback === undefined) delete process.env.CONSOLE_SKILLS_CALLBACK_SECRET
    else process.env.CONSOLE_SKILLS_CALLBACK_SECRET = savedCallback
    if (savedIngest === undefined) delete process.env.WEB_SKILLS_INGEST_TOKEN
    else process.env.WEB_SKILLS_INGEST_TOKEN = savedIngest
  })

  it("acknowledges repo.published instead of rejecting it", async () => {
    const res = await POST(signed(JSON.stringify(WRITE_CALLBACK)))

    // 400 在这里是纯损失：报文里没有任何可落库的数据，而 console 会因此把一次
    // 成功的发布记成回调失败。
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      event: "repo.published",
      ingested: false,
    })
  })

  it("acknowledges repo.registered too", async () => {
    const res = await POST(signed(JSON.stringify({ ...WRITE_CALLBACK, event: "repo.registered" })))

    expect(res.status).toBe(200)
  })

  it("still rejects an event it does not know", async () => {
    // 认事件而不是"认得这份报文"：一个没见过的形状必须继续被拒，否则路由会变成
    // 任何签名报文都返回 200 的黑洞。
    const res = await POST(signed(JSON.stringify({ event: "repo.deleted", fullName: "acme/pdf" })))

    expect(res.status).toBe(400)
  })

  it("still validates a skill delivery as a skill delivery", async () => {
    const res = await POST(signed(JSON.stringify(SKILL_DELIVERY)))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'missing required fields: repo_full_name, repo_owner, skill_dir, name',
    })
  })
})

describe("isConsoleWriteCallback", () => {
  it("recognises both write events", () => {
    for (const event of ["repo.registered", "repo.published"]) {
      expect(isConsoleWriteCallback({ ...WRITE_CALLBACK, event })).toBe(true)
    }
  })

  it("does not take a skill delivery that happens to carry console field names", () => {
    // 技能投递的 `data` 里出现 `fullName` 之类并不稀奇。靠"有没有某个键"分流会
    // 把一份投递报文当回调静默吞掉：路由返回 200，而技能永远不入库。
    expect(
      isConsoleWriteCallback({ ...SKILL_DELIVERY, event: "skill_updated", fullName: "acme/pdf" })
    ).toBe(false)
  })

  it("needs the event name and the repository it is about", () => {
    expect(isConsoleWriteCallback({ eventId: "x", occurredAt: "now" })).toBe(false)
    expect(isConsoleWriteCallback({ event: "repo.published" })).toBe(false)
    expect(isConsoleWriteCallback({ event: "repo.published", fullName: "" })).toBe(false)
    expect(isConsoleWriteCallback(null)).toBe(false)
  })
})