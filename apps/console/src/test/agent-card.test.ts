/**
 * Tests for the A2A wire layer.
 *
 * Scoped to the parts that are decisions rather than plumbing: version
 * negotiation, which method names map to what, and the shapes a client parses.
 * The skills themselves are exercised against the real database through the
 * endpoint rather than mocked here — a mock would only assert that the mock
 * returns what the mock returns.
 */
import { describe, expect, it } from "vitest"
import { negotiateVersion } from "@/lib/agent/rpc"
import { agentCard, CARD_PATH } from "@/lib/agent/card"

describe("negotiateVersion", () => {
  it("treats an absent or empty header as 0.3", () => {
    // §3.6.2: empty means 0.3. Defaulting an unstated version up to 1.0 hands a
    // 0.3 client a `TASK_STATE_COMPLETED` it has never heard of.
    expect(negotiateVersion(null)).toEqual({ ok: true, version: "0.3" })
    expect(negotiateVersion("")).toEqual({ ok: true, version: "0.3" })
    expect(negotiateVersion("   ")).toEqual({ ok: true, version: "0.3" })
  })

  it("accepts the spellings clients actually send", () => {
    for (const header of ["1.0", "1", "v1.0", "1.0.3"]) {
      expect(negotiateVersion(header)).toEqual({ ok: true, version: "1.0" })
    }
    expect(negotiateVersion("0.3")).toEqual({ ok: true, version: "0.3" })
    expect(negotiateVersion("0.2")).toEqual({ ok: true, version: "0.3" })
  })

  it("refuses an unknown major rather than guessing", () => {
    const result = negotiateVersion("2.0")
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.error.code).toBe(-32001)
  })
})

describe("agentCard", () => {
  it("declares no authentication, which is the point", () => {
    const card = agentCard("1.0") as Record<string, unknown>
    // A card that named a security scheme would be telling clients to send a
    // credential this server does not want.
    expect(card.securitySchemes).toBeUndefined()
    expect(card.securityRequirements).toBeUndefined()
  })

  it("uses the 1.0 envelope for 1.0 and the 0.3 envelope for 0.3", () => {
    const current = agentCard("1.0") as Record<string, unknown>
    expect(current.protocolVersion).toBe("1.0")
    expect(current.supportedInterfaces).toEqual([
      expect.objectContaining({
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      }),
    ])
    expect(current.url).toBeUndefined()

    const legacy = agentCard("0.3") as Record<string, unknown>
    expect(legacy.url).toBeDefined()
    expect(legacy.preferredTransport).toBe("JSONRPC")
    expect(legacy.supportedInterfaces).toBeUndefined()
    expect(legacy.protocolVersion).toBeUndefined()
  })

  it("advertises the same skills in both versions", () => {
    const ids = (version: "1.0" | "0.3") =>
      (agentCard(version) as { skills: { id: string }[] }).skills.map(
        (s) => s.id
      )
    expect(ids("1.0")).toEqual(ids("0.3"))
    expect(ids("1.0")).toEqual([
      "explain",
      "rankings",
      "rising-stars",
      "project-detail",
      "anomalies",
    ])
  })

  it("does not claim capabilities it refuses at runtime", () => {
    // The handler answers SendStreamingMessage with UnsupportedOperationError,
    // so a card claiming streaming would be advertising a lie.
    const card = agentCard("1.0") as { capabilities: Record<string, boolean> }
    expect(card.capabilities.streaming).toBe(false)
    expect(card.capabilities.pushNotifications).toBe(false)
  })

  it("serves each version at the discovery path its spec fixed", () => {
    expect(CARD_PATH["1.0"]).toBe("/.well-known/agent-card.json")
    expect(CARD_PATH["0.3"]).toBe("/.well-known/agent.json")
  })
})
