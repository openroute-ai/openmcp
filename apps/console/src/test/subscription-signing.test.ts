/**
 * 订阅投递的验签密钥是**派生**出来的（`deriveSigningKey`），库里没有它的一列。
 *
 * 钉住接收方那两步配方：自己 `sha256(key 明文)` 得到 `key_hash`，再按同一个 label
 * 派生。两端算错一位，所有投递都会被判成伪造 —— 而两端都能「正常签/正常验」，只有
 * 换一把 key 时才会暴露，所以这里要有一条同时覆盖两端的往返。
 *
 * 不碰 DB：`key_hash` 对这一层是输入，怎么来的不影响结果。
 */
import { createHash, createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  deriveSigningKey,
  SUBSCRIPTION_SIGNING_LABEL,
} from "@/lib/api/subscriptions"
import { signPayload, verifySignature } from "@/lib/webhook/client"

const PLAINTEXT = "sk_radar_01JQZ8"
const KEY_HASH = createHash("sha256").update(PLAINTEXT, "utf8").digest("hex")
const DERIVED = deriveSigningKey(KEY_HASH)

describe("SUBSCRIPTION_SIGNING_LABEL", () => {
  it("is part of the wire contract", () => {
    // 换 label = 所有接收方同时验不过。改它得跟一次迁移一起做，不能顺手改。
    expect(SUBSCRIPTION_SIGNING_LABEL).toBe("mcp-radar-subscription-v1")
  })
})

describe("deriveSigningKey", () => {
  it("matches the recipe a receiver computes from the plaintext", () => {
    expect(DERIVED).toBe(
      createHmac("sha256", SUBSCRIPTION_SIGNING_LABEL)
        .update(KEY_HASH, "utf8")
        .digest("base64url")
    )
  })

  it("is deterministic", () => {
    expect(deriveSigningKey(KEY_HASH)).toBe(DERIVED)
  })

  it("changes with the key", () => {
    const other = createHash("sha256")
      .update("sk_radar_01JQZ9", "utf8")
      .digest("hex")
    expect(deriveSigningKey(other)).not.toBe(DERIVED)
  })

  it("is base64url without padding, i.e. a header-safe value", () => {
    expect(DERIVED).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("does not return the key hash itself", () => {
    // `key_hash` 是库里最敏感的一段字节；派生值必须是它的另一个值，
    // 否则「只有 hash 就能调 API」这个反向结论就成立了。
    expect(DERIVED).not.toBe(KEY_HASH)
    expect(DERIVED).not.toContain(KEY_HASH)
  })
})

describe("delivery signature round trip", () => {
  const body = '{"watermark":"2026-03-01T12:00:00.000Z"}'
  const timestamp = String(Date.parse("2026-03-01T12:00:00Z") / 1000)

  it("verifies a payload signed with the derived key", () => {
    expect(
      verifySignature(
        body,
        timestamp,
        DERIVED,
        signPayload(body, timestamp, DERIVED)
      )
    ).toBe(true)
  })

  it("rejects a payload signed under another key", () => {
    // 换 key（或两把 key 搞混）必须表现为验签失败，而不是静默通过。
    const otherHash = createHash("sha256")
      .update("sk_radar_01JQZ9", "utf8")
      .digest("hex")
    const signature = signPayload(body, timestamp, deriveSigningKey(otherHash))
    expect(verifySignature(body, timestamp, DERIVED, signature)).toBe(false)
  })
})
