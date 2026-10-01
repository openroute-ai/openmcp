/**
 * Provider OAuth `state` 的签名校验。
 *
 * 这里验的是一个真实的越权路径。回调端点 `GET /api/oauth/callback/mcp` 是
 * 公开路由，它唯一用来定位资产的凭据就是 `state`。旧的实现把 `state` 写成
 * `base64url(JSON)` —— base64 是编码不是加密，攻击者可以自己拼一个
 * `{"serverName":"victim__server","authorId":"attacker"}`，然后把上游返回的
 * `code` 和这个伪造 state 一起打过来，回调就会把结果写到受害者的资产上。
 *
 * 所以这里覆盖三类：伪造的 state 必须被拒；合法 state 必须能验过；签名过的
 * state 不能被改动任何一个字段后仍然通过。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  OAUTH_STATE_TTL_SEC,
  signOAuthState,
  verifyOAuthState,
} from "@/lib/agent-install/oauth-state"

const SECRET = "test-state-secret"
let savedSecret: string | undefined
let savedNextAuth: string | undefined
let savedAuth: string | undefined

describe("oauth state signing", () => {
  beforeEach(() => {
    savedSecret = process.env.OAUTH_STATE_SECRET
    savedAuth = process.env.AUTH_SECRET
    savedNextAuth = process.env.NEXTAUTH_SECRET
    process.env.OAUTH_STATE_SECRET = SECRET
  })

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore("OAUTH_STATE_SECRET", savedSecret)
    restore("AUTH_SECRET", savedAuth)
    restore("NEXTAUTH_SECRET", savedNextAuth)
  })

  it("round-trips a signed state", () => {
    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return

    const verified = verifyOAuthState(signed.state)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.assetName).toBe("alice__weather")
    expect(verified.payload.authorId).toBe("auth_1")
  })

  it("rejects a hand-crafted unsigned state", () => {
    // 这就是攻击者能直接构造出来的东西：没有签名段，且 payload 内容任意。
    const forged = Buffer.from(
      JSON.stringify({ serverName: "victim__server", authorId: "attacker" }),
    ).toString("base64url")
    const result = verifyOAuthState(forged)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("state 格式不合法")
  })

  it("rejects a payload re-signed for a different asset", () => {
    // 拿到自己合法 state 的人不能改字段再用 —— 改任何一个字节签名就对不上。
    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return

    const [body, signature] = signed.state.split(".")
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"))
    payload.assetName = "victim__server"
    const tampered = Buffer.from(JSON.stringify(payload)).toString("base64url")

    expect(verifyOAuthState(`${tampered}.${signature}`).ok).toBe(false)
  })

  it("rejects a state signed with a different secret", () => {
    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return

    // 轮换密钥后，旧 state 立刻失效 —— 这是期望行为，不是可用性问题。
    process.env.OAUTH_STATE_SECRET = "a-different-secret"
    expect(verifyOAuthState(signed.state).ok).toBe(false)
  })

  it("rejects an expired state", () => {
    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return

    // 先验一次拿到真实 `iat`，再把 `nowSec` 推到它之后 —— 用相对时间而不是
    // 固定时间戳，避免测试依赖运行时时钟。
    const first = verifyOAuthState(signed.state)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const stillFresh = verifyOAuthState(signed.state, {
      nowSec: first.payload.iat + OAUTH_STATE_TTL_SEC - 5,
    })
    expect(stillFresh.ok).toBe(true)

    const expired = verifyOAuthState(signed.state, {
      nowSec: first.payload.iat + OAUTH_STATE_TTL_SEC + 60,
    })
    expect(expired.ok).toBe(false)
    if (expired.ok) return
    expect(expired.reason).toBe("state 已过期")
  })

  it("rejects an implausible future issue time", () => {
    // 伪造一个极大的 iat 可以拿到近乎永久有效的凭据，所以未来时间要挡住。
    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return

    const result = verifyOAuthState(signed.state, { nowSec: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("state 签发时间异常")
  })

  it("refuses to sign when no secret is configured", () => {
    // 关键点：密钥缺失时不能"降级成不校验"。那等于在生产环境悄悄开一个洞。
    delete process.env.OAUTH_STATE_SECRET
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET

    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(false)
    expect(verifyOAuthState("anything.atall").ok).toBe(false)
  })

  it("falls back to AUTH_SECRET when OAUTH_STATE_SECRET is absent", () => {
    delete process.env.OAUTH_STATE_SECRET
    process.env.AUTH_SECRET = SECRET

    const signed = signOAuthState({ assetName: "alice__weather", authorId: "auth_1" })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    expect(verifyOAuthState(signed.state).ok).toBe(true)
  })
})