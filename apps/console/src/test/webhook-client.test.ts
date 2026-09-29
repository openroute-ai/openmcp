/**
 * Tests for the signed webhook client.
 *
 * Weighted towards the security properties rather than the happy path, because
 * the happy path is a `fetch` that resolves. What matters is that a receiver
 * can reject a forged or replayed request, which the source app's design could
 * not do: it sent the shared token back as its own signature.
 */
import { createHmac } from "node:crypto"
import { describe, expect, it, vi, type MockedFunction } from "vitest"
import {
  hasAccepted,
  isFreshTimestamp,
  sendWebhook,
  signPayload,
  summarise,
  verifySignature,
  SIGNATURE_HEADER,
  SIGNATURE_SECRET_HEADER,
} from "@/lib/webhook/client"

const SECRET = "shhh"
const NOW = new Date("2026-03-01T12:00:00Z")
const TIMESTAMP = String(NOW.getTime() / 1000)

/**
 * A fetch stand-in that records its calls and answers 200.
 *
 * Typed as `typeof fetch` rather than declaring the two parameters it ignores,
 * so the recorded calls come back typed and nothing unused is declared.
 */
function okFetch(): MockedFunction<typeof fetch> {
  return vi.fn(
    async () => new Response("", { status: 200 })
  ) as unknown as MockedFunction<typeof fetch>
}

describe("signPayload", () => {
  it("produces the digest a receiver would compute", () => {
    const expected = createHmac("sha256", SECRET)
      .update(`${TIMESTAMP}.{"a":1}`)
      .digest("hex")

    expect(signPayload('{"a":1}', TIMESTAMP, SECRET)).toBe(`sha256=${expected}`)
  })

  it("changes when the body changes", () => {
    expect(signPayload('{"a":1}', TIMESTAMP, SECRET)).not.toBe(
      signPayload('{"a":2}', TIMESTAMP, SECRET)
    )
  })

  it("changes when the timestamp changes", () => {
    // The reason the timestamp is inside the signed string: a captured body
    // replayed later must not produce the same signature.
    expect(signPayload('{"a":1}', TIMESTAMP, SECRET)).not.toBe(
      signPayload('{"a":1}', String(Number(TIMESTAMP) + 3600), SECRET)
    )
  })

  it("changes when the secret changes", () => {
    expect(signPayload('{"a":1}', TIMESTAMP, SECRET)).not.toBe(
      signPayload('{"a":1}', TIMESTAMP, "other")
    )
  })
})

describe("verifySignature", () => {
  const body = '{"a":1}'

  it("accepts a signature it produced", () => {
    expect(
      verifySignature(
        body,
        TIMESTAMP,
        SECRET,
        signPayload(body, TIMESTAMP, SECRET)
      )
    ).toBe(true)
  })

  it("rejects a missing signature", () => {
    expect(verifySignature(body, TIMESTAMP, SECRET, undefined)).toBe(false)
    expect(verifySignature(body, TIMESTAMP, SECRET, null)).toBe(false)
    expect(verifySignature(body, TIMESTAMP, SECRET, "")).toBe(false)
  })

  it("rejects a body modified after signing", () => {
    const signature = signPayload(body, TIMESTAMP, SECRET)
    expect(verifySignature(`${body} `, TIMESTAMP, SECRET, signature)).toBe(
      false
    )
  })

  it("rejects the wrong secret", () => {
    const signature = signPayload(body, TIMESTAMP, "other")
    expect(verifySignature(body, TIMESTAMP, SECRET, signature)).toBe(false)
  })

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to come
    // first or a truncated header turns into a 500 instead of a rejection.
    expect(() =>
      verifySignature(body, TIMESTAMP, SECRET, "sha256=abc")
    ).not.toThrow()
    expect(verifySignature(body, TIMESTAMP, SECRET, "sha256=abc")).toBe(false)
  })

  it("rejects a token being passed off as a signature", () => {
    // Exactly what the source app sent: the shared token, in the signature
    // header. A receiver that skipped verification would accept it.
    expect(verifySignature(body, TIMESTAMP, SECRET, SECRET)).toBe(false)
  })
})

describe("isFreshTimestamp", () => {
  it("accepts the current moment", () => {
    expect(isFreshTimestamp(TIMESTAMP, NOW)).toBe(true)
  })

  it("accepts a small clock difference in either direction", () => {
    expect(isFreshTimestamp(String(Number(TIMESTAMP) - 60), NOW)).toBe(true)
    expect(isFreshTimestamp(String(Number(TIMESTAMP) + 60), NOW)).toBe(true)
  })

  it("rejects a replay from long ago", () => {
    expect(isFreshTimestamp(String(Number(TIMESTAMP) - 3600), NOW)).toBe(false)
  })

  it("rejects a timestamp far in the future", () => {
    // Not clamped to one direction: a future timestamp would otherwise be a way
    // to keep a captured request valid indefinitely.
    expect(isFreshTimestamp(String(Number(TIMESTAMP) + 3600), NOW)).toBe(false)
  })

  it("rejects an unparseable timestamp", () => {
    expect(isFreshTimestamp("not-a-timestamp", NOW)).toBe(false)
  })

  it("reads a bare second count as seconds, not milliseconds", () => {
    // The header is Unix seconds. Parsed as milliseconds it would land in 1970
    // and every check would reject genuine requests.
    expect(isFreshTimestamp(TIMESTAMP, NOW)).toBe(true)
  })

  it("accepts an ISO string from a receiver that reformats the header", () => {
    expect(isFreshTimestamp(NOW.toISOString(), NOW)).toBe(true)
  })
})

describe("sign then verify", () => {
  /** Sends one payload and hands back the request a receiver would see. */
  async function sendAndCapture(): Promise<{
    body: string
    headers: Record<string, string>
  }> {
    const fetchImpl = okFetch()
    await sendWebhook(
      ["https://a.test/hook"],
      { event_type: "repo_updated" },
      {
        secret: SECRET,
        fetchImpl,
        now: () => NOW,
      }
    )

    const [, init] = fetchImpl.mock.calls[0]!
    return {
      body: init!.body as string,
      headers: init!.headers as Record<string, string>,
    }
  }

  it("accepts a request it just produced", async () => {
    // The end-to-end property, and the reason parseTimestamp exists: the
    // sender and the receiver must agree on what the timestamp header means.
    const { body, headers } = await sendAndCapture()

    expect(
      verifySignature(
        body,
        headers[SIGNATURE_HEADER]!,
        SECRET,
        headers[SIGNATURE_SECRET_HEADER]
      )
    ).toBe(true)
    expect(isFreshTimestamp(headers[SIGNATURE_HEADER]!, NOW)).toBe(true)
  })

  it("rejects the same request once the window has passed", async () => {
    const { body, headers } = await sendAndCapture()

    // Still a valid signature: the HMAC does not expire on its own, which is
    // exactly why the receiver has to bound the timestamp itself.
    expect(
      verifySignature(
        body,
        headers[SIGNATURE_HEADER]!,
        SECRET,
        headers[SIGNATURE_SECRET_HEADER]
      )
    ).toBe(true)
    expect(
      isFreshTimestamp(
        headers[SIGNATURE_HEADER]!,
        new Date(NOW.getTime() + 3600_000)
      )
    ).toBe(false)
  })
})

describe("sendWebhook", () => {
  it("does nothing when no endpoint is configured", async () => {
    const fetchImpl = okFetch()
    expect(await sendWebhook([], { a: 1 }, { fetchImpl })).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("signs the exact body it sends", async () => {
    const fetchImpl = okFetch()
    await sendWebhook(
      ["https://a.test/hook"],
      { a: 1 },
      { secret: SECRET, fetchImpl, now: () => NOW }
    )

    const [, init] = fetchImpl.mock.calls[0]!
    const headers = init!.headers as Record<string, string>

    expect(headers[SIGNATURE_HEADER]).toBe(TIMESTAMP)
    expect(
      verifySignature(
        init!.body as string,
        TIMESTAMP,
        SECRET,
        headers[SIGNATURE_SECRET_HEADER]
      )
    ).toBe(true)
  })

  it("omits the signature header when no secret is configured", async () => {
    // The token-based receivers would ignore it, and sending a signature
    // computed with an empty secret would look like a valid one.
    const fetchImpl = okFetch()
    await sendWebhook(["https://a.test/hook"], { a: 1 }, { fetchImpl })

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<
      string,
      string
    >
    expect(headers[SIGNATURE_SECRET_HEADER]).toBeUndefined()
  })

  it("sends a bearer token when one is configured", async () => {
    const fetchImpl = okFetch()
    await sendWebhook(
      ["https://a.test/hook"],
      { a: 1 },
      { token: "t0ken", fetchImpl }
    )

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<
      string,
      string
    >
    expect(headers.authorization).toBe("Bearer t0ken")
  })

  it("reaches every endpoint even when one is down", async () => {
    // The reason several mirrors are configured: a single dead one must not
    // stop the others from getting the data.
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("dead")) {
        throw new Error("ECONNREFUSED")
      }
      return new Response("", { status: 200 })
    })

    const results = await sendWebhook(
      ["https://dead.test/hook", "https://alive.test/hook"],
      { a: 1 },
      { fetchImpl }
    )

    expect(results).toEqual([
      { url: "https://dead.test/hook", success: false, error: "ECONNREFUSED" },
      { url: "https://alive.test/hook", success: true, status: 200 },
    ])
    expect(hasAccepted(results)).toBe(true)
  })

  it("reports a non-2xx response as a failure", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("nope", { status: 503, statusText: "Unavailable" })
    )

    const [result] = await sendWebhook(
      ["https://a.test/hook"],
      { a: 1 },
      { fetchImpl }
    )

    expect(result?.success).toBe(false)
    expect(result?.status).toBe(503)
    expect(result?.error).toBe("503 Unavailable")
  })

  it("times out rather than holding the caller open", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          )
        })
    )

    const [result] = await sendWebhook(
      ["https://a.test/hook"],
      { a: 1 },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 10,
      }
    )

    expect(result?.success).toBe(false)
    expect(result?.error).toBe("aborted")
  })
})

describe("summarise", () => {
  it("reports when nothing is configured", () => {
    expect(summarise([])).toBe("no endpoints configured")
  })

  it("reports a clean sweep", () => {
    expect(
      summarise([
        { url: "a", success: true },
        { url: "b", success: true },
      ])
    ).toBe("2/2 accepted")
  })

  it("names the endpoints that failed", () => {
    const summary = summarise([
      { url: "a", success: true },
      { url: "b", success: false, error: "500 Internal Server Error" },
    ])

    expect(summary).toContain("1/2 accepted")
    expect(summary).toContain("b (500 Internal Server Error)")
  })
})
