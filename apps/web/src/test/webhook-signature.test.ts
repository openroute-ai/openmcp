/**
 * console → web 技能投递的签名校验。
 *
 * 这里验的是一条真实的越权路径。`POST /api/webhook/daily/skills` 是公开路由，
 * 它写入的是 marketplace 的上架数据。console 现在按提交方逐个下发密钥
 * （提交仓库时以 `callbackSecret` 交给它），所以接收端如果只看一个全站共享的
 * bearer，任何拿到那个 bearer 的人都能往站点里注入任意技能文档 —— 而技能文档
 * 是会被安装到用户机器上执行的。
 *
 * 覆盖三类：合法签名必须通过；篡改 body 或换密钥必须失败；超出新鲜度窗口的
 * 签名即使完全正确也必须失败 —— 最后这条是签名与校验和的区别，没有它截获的
 * 请求可以无限重放。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  assertSkillsWebhookAuthorized,
  skillsCallbackSecret,
  skillsIngestToken,
} from "@/lib/webhook/bearer-auth"
import {
  isFreshSignature,
  isValidConsoleSignature,
  signPayload,
  verifySignature,
} from "@/lib/webhook/signature"

const SECRET = "per-submitter-callback-secret"
const BODY = JSON.stringify({ event_type: "skill_updated", data: { repo_full_name: "acme/pdf" } })

/** Builds the request console would send: signed over the exact bytes sent. */
function signedRequest(body: string, secret: string, at: Date = new Date()) {
  const timestamp = String(Math.floor(at.getTime() / 1000))
  return new Request("http://localhost/api/webhook/daily/skills", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signPayload(body, timestamp, secret),
    },
    body,
  })
}

describe("console skill webhook signature", () => {
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

  it("accepts a genuine signature", () => {
    expect(assertSkillsWebhookAuthorized(signedRequest(BODY, SECRET), BODY)).toBeNull()
  })

  it("rejects a signature made with a different key", () => {
    const request = signedRequest(BODY, "someone-elses-secret")
    expect(assertSkillsWebhookAuthorized(request, BODY)?.status).toBe(401)
  })

  it("rejects a correct signature over a different body", () => {
    // 签名覆盖的是发送的字节。body 被换掉而签名不动，等于没有签名。
    const tampered = JSON.stringify({
      event_type: "skill_updated",
      data: { repo_full_name: "attacker/evil" },
    })
    const request = signedRequest(BODY, SECRET)
    expect(assertSkillsWebhookAuthorized(request, tampered)?.status).toBe(401)
  })

  it("rejects a replayed request outside the freshness window", () => {
    const anHourAgo = new Date(Date.now() - 3_600_000)
    const request = signedRequest(BODY, SECRET, anHourAgo)
    // HMAC 本身仍然算得出来，因为 timestamp 也在被覆盖的字节里。
    expect(
      verifySignature(BODY, String(Math.floor(anHourAgo.getTime() / 1000)), SECRET, request.headers.get("x-webhook-signature"))
    ).toBe(true)
    expect(isValidConsoleSignature(request, BODY, SECRET)).toBe(false)
    expect(assertSkillsWebhookAuthorized(request, BODY)?.status).toBe(401)
  })

  it("rejects a timestamp far in the future", () => {
    // 未来时间戳与过期的一样可疑，放行它等于让时钟偏移的请求重置窗口。
    const ahead = new Date(Date.now() + 3_600_000)
    expect(isFreshSignature(String(Math.floor(ahead.getTime() / 1000)))).toBe(false)
  })

  it("accepts a plain bearer for a console that predates per-submitter callbacks", () => {
    process.env.WEB_SKILLS_INGEST_TOKEN = "export-token"
    const request = new Request("http://localhost/api/webhook/daily/skills", {
      method: "POST",
      headers: { authorization: "Bearer export-token" },
      body: BODY,
    })
    expect(assertSkillsWebhookAuthorized(request, BODY)).toBeNull()
  })

  it("fails closed with 404 when no credential is configured", () => {
    // 不是 401：未配置的部署不应该把这个路由的存在告诉任何人。
    delete process.env.CONSOLE_SKILLS_CALLBACK_SECRET
    const request = new Request("http://localhost/api/webhook/daily/skills", { method: "POST" })
    expect(assertSkillsWebhookAuthorized(request, BODY)?.status).toBe(404)
    expect(skillsCallbackSecret()).toBeUndefined()
    expect(skillsIngestToken()).toBeUndefined()
  })

  it("keeps the two credentials independent", () => {
    // 入站的裸 bearer 只是老 console 的兜底，callback secret 才是 console 签名用的
    // 密钥。合成一个值就等于把"能发一个裸 bearer"升级成"能伪造签名过的技能文档"。
    process.env.WEB_SKILLS_INGEST_TOKEN = "export-token"
    expect(skillsIngestToken()).toBe("export-token")
    expect(skillsCallbackSecret()).toBe(SECRET)
  })
})