/**
 * The API key guard's decision table.
 *
 * `authenticateApiKey` is exercised through a fake `lookup` rather than a real
 * database: what is worth pinning down here is the *order* of the checks and the
 * status codes, and both are invisible to a test that needs a live Postgres to
 * run. The rate limiter is likewise replaced, because a `429` in a unit test
 * should come from a stub that says so, not from a shared counter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { authenticateApiKey } from "@/lib/api/guard"
import { apiKeyHashesEqual, hashApiKey, normalizeScopes } from "@/lib/api/keys"
import {
  API_KEY_PLAINTEXT_PREFIX,
  API_SCOPES,
  buildApiKeyPlaintext,
  isApiScope,
  readApiKeyPrefix,
  type ApiScope,
  type ApiTier,
} from "@/lib/api/scopes"
import {
  setApiRateLimiterForTests,
  type RateLimiter,
  type RateLimitResult,
} from "@/lib/api/rate-limit"

const FUTURE = new Date(Date.now() + 60 * 60 * 1000)
const PAST = new Date(Date.now() - 60 * 1000)

function authRequest(header?: string) {
  return new Request("https://console.test/api/v1/repos", {
    headers: header ? { authorization: header } : {},
  })
}

/** A limiter that always allows, with an inspectable call log. */
function allowingLimiter(): RateLimiter & { calls: string[] } {
  const calls: string[] = []
  return {
    driver: "redis",
    calls,
    async consume(key): Promise<RateLimitResult> {
      calls.push(key)
      return {
        allowed: true,
        limit: 60,
        remaining: 59,
        retryAfter: null,
        resetAt: Date.now() + 60_000,
      }
    },
  }
}

function denyingLimiter(keyPrefix: "k:" | "d:"): RateLimiter {
  return {
    driver: "redis",
    async consume(key): Promise<RateLimitResult> {
      const denied = key.startsWith(keyPrefix)
      return {
        allowed: !denied,
        limit: 60,
        remaining: 0,
        retryAfter: denied ? 42 : null,
        resetAt: Date.now() + 60_000,
      }
    },
  }
}

/** The default limiter most tests want: always allows, and records its keys. */
let limiter: RateLimiter & { calls: string[] }

beforeEach(() => {
  limiter = allowingLimiter()
  setApiRateLimiterForTests(limiter)
})

afterEach(() => {
  // Left installed would leak into the next file's `getApiRateLimiter()` call.
  setApiRateLimiterForTests(undefined)
})

/**
 * Mirrors what `findApiKeyByPlaintext` returns, i.e. scopes already narrowed to
 * `ApiScope`. The narrowing happens *inside* the real lookup, so a stub that
 * handed back raw strings would be testing a shape the production path never
 * produces.
 */
type Row = {
  id: string
  scopes: ApiScope[]
  userId: string | null
  tier: ApiTier
  submitterId: string | null
  rateLimitRpm: number
  rateLimitRpd: number
  revokedAt: Date | null
  expiresAt: Date | null
}

function activeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "key-1",
    scopes: [...API_SCOPES],
    userId: null,
    tier: "service",
    submitterId: "user-7",
    rateLimitRpm: 60,
    rateLimitRpd: 5000,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

function lookupReturning(row: Row | undefined) {
  return vi.fn(async () => row)
}

describe("authenticateApiKey", () => {
  it("accepts a valid key and reports its scopes", async () => {
    const lookup = lookupReturning(activeRow())

    const result = await authenticateApiKey(authRequest("Bearer mcp_radar_abcd_x"), {
      lookup,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.principal.keyId).toBe("key-1")
    expect(result.principal.submitterId).toBe("user-7")
    expect([...result.principal.scopes].sort()).toEqual([...API_SCOPES].sort())
  })

  it("reads the scheme case-insensitively, as RFC 6750 requires", async () => {
    const lookup = lookupReturning(activeRow())

    for (const header of ["Bearer t", "bearer t", "BEARER t", "BeArEr t"]) {
      const result = await authenticateApiKey(authRequest(header), { lookup })
      expect(result.ok).toBe(true)
    }
  })

  it("rejects a request with no Authorization header as 401", async () => {
    const result = await authenticateApiKey(authRequest(), {
      lookup: lookupReturning(activeRow()),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
    expect(result.response.headers.get("www-authenticate")).toContain("Bearer")
  })

  it("rejects a malformed Authorization header before touching the database", async () => {
    const lookup = lookupReturning(activeRow())

    // No scheme, wrong scheme, empty token: none of these should reach `lookup`.
    for (const header of ["mcp_radar_abcd_x", "Basic abc", "Bearer", "Bearer  "]) {
      const result = await authenticateApiKey(authRequest(header), { lookup })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(401)
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  it("answers 404 for an unknown key, not 401", async () => {
    // The distinction between "no such key" and "no such route" is what an
    // unauthenticated prober is measuring. Both must look the same.
    const result = await authenticateApiKey(authRequest("Bearer nope"), {
      lookup: lookupReturning(undefined),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(404)
  })

  it("answers 401 key_revoked for a revoked key", async () => {
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow({ revokedAt: PAST })),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
    const body = (await result.response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("key_revoked")
  })

  it("answers 401 key_expired once the expiry has passed", async () => {
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow({ expiresAt: PAST })),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    const body = (await result.response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("key_expired")
  })

  it("treats a future expiry as valid", async () => {
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow({ expiresAt: FUTURE })),
    })

    expect(result.ok).toBe(true)
  })

  it("answers 403 insufficient_scope when the scope is missing", async () => {
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      scope: "repos:write",
      lookup: lookupReturning(activeRow({ scopes: ["repos:read"] })),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    const wwwAuth = result.response.headers.get("www-authenticate") ?? ""
    expect(wwwAuth).toContain("insufficient_scope")
    expect(wwwAuth).toContain("repos:write")
    const body = (await result.response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("insufficient_scope")
  })

  it("does not let read scope imply write scope", async () => {
    // Scopes are additive by design: a key that can read cannot write, and the
    // only way to get both is to ask for both.
    const readOnly = lookupReturning(activeRow({ scopes: ["repos:read"] }))

    const read = await authenticateApiKey(authRequest("Bearer t"), {
      scope: "repos:read",
      lookup: readOnly,
    })
    const write = await authenticateApiKey(authRequest("Bearer t"), {
      scope: "repos:write",
      lookup: readOnly,
    })

    expect(read.ok).toBe(true)
    expect(write.ok).toBe(false)
  })

  it("does not consume quota for a rejected request", async () => {
    // Rate limiting runs last on purpose: charging a revoked or under-scoped
    // key would let anyone holding a dead key keep another key's budget down.
    const calls = (limiter as RateLimiter & { calls: string[] }).calls

    await authenticateApiKey(authRequest("Bearer t"), {
      scope: "repos:write",
      lookup: lookupReturning(activeRow({ scopes: ["repos:read"] })),
    })
    await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow({ revokedAt: PAST })),
    })

    expect(calls).toEqual([])
  })

  it("counts the per-minute and per-day windows separately", async () => {
    const calls = (limiter as RateLimiter & { calls: string[] }).calls

    await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow()),
    })

    expect(calls).toEqual(["k:key-1", "d:key-1"])
  })

  it("reports 429 with Retry-After when the minute window is spent", async () => {
    setApiRateLimiterForTests(denyingLimiter("k:"))
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow()),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(429)
    expect(result.response.headers.get("retry-after")).toBe("42")
    expect(result.response.headers.get("ratelimit-limit")).toBe("60")
    expect(result.response.headers.get("ratelimit-remaining")).toBe("0")
  })

  it("reports 429 when only the day window is spent", async () => {
    setApiRateLimiterForTests(denyingLimiter("d:"))
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      lookup: lookupReturning(activeRow()),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(429)
    const body = (await result.response.json()) as { error: { message: string } }
    expect(body.error.message).toContain("每日")
  })

  it("drops an unrecognised scope instead of widening the grant", async () => {
    // A scope name outside `API_SCOPES` can reach here from a hand-written
    // UPDATE or a past migration. It must not become a permission: the guard
    // re-narrows with `normalizeScopes`, so `admin:all` simply disappears and
    // only the known scope survives.
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      scope: "repos:read",
      lookup: lookupReturning({
        ...activeRow(),
        scopes: ["repos:read", "admin:all"] as unknown as ApiScope[],
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.principal.scopes]).toEqual(["repos:read"])
  })

it("refuses a scope that exists only as an unknown name", async () => {
    const result = await authenticateApiKey(authRequest("Bearer t"), {
      scope: "repos:write",
      lookup: lookupReturning({
        ...activeRow(),
        scopes: ["admin:all"] as unknown as ApiScope[],
      }),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
  })
})

describe("scopes", () => {
  it("round-trips the plaintext format", () => {
    const plaintext = buildApiKeyPlaintext("aB3d", "s3cret-value_1234")

    expect(plaintext).toBe(`${API_KEY_PLAINTEXT_PREFIX}aB3d_s3cret-value_1234`)
    expect(readApiKeyPrefix(plaintext)).toBe("aB3d")
  })

  it("returns null for values that are not ours", () => {
    // Not a validation: a real key check is the hash lookup, and it does not
    // care about the shape. This only drives the UI's display column.
    expect(readApiKeyPrefix("sk-something")).toBeNull()
    expect(readApiKeyPrefix(`${API_KEY_PLAINTEXT_PREFIX}`)).toBeNull()
    expect(readApiKeyPrefix(`${API_KEY_PLAINTEXT_PREFIX}_secret`)).toBeNull()
  })

  it("recognises exactly the declared scopes", () => {
    expect(API_SCOPES.every(isApiScope)).toBe(true)
    expect(isApiScope("repos:read")).toBe(true)
    expect(isApiScope("repos:write")).toBe(true)
    expect(isApiScope("repos:*")).toBe(false)
    expect(isApiScope("repos:delete")).toBe(false)
    expect(isApiScope("")).toBe(false)
  })

  it("drops unknown scopes instead of widening the grant", () => {
    expect(normalizeScopes(["repos:read", "nope", "admin:all"])).toEqual([
      "repos:read",
    ])
    expect(normalizeScopes([])).toEqual([])
  })
})

describe("hashApiKey", () => {
  it("is deterministic, so one hash serves the whole lookup", () => {
    expect(hashApiKey("mcp_radar_abcd_secret")).toBe(
      hashApiKey("mcp_radar_abcd_secret")
    )
  })

  it("separates different plaintexts", () => {
    expect(hashApiKey("mcp_radar_abcd_a")).not.toBe(
      hashApiKey("mcp_radar_abcd_b")
    )
  })

  it("compares in constant time", () => {
    const hash = hashApiKey("mcp_radar_abcd_secret")
    expect(apiKeyHashesEqual(hash, hash)).toBe(true)
    expect(apiKeyHashesEqual(hash, hashApiKey("mcp_radar_abcd_other"))).toBe(false)
    // Different lengths must not throw; a hex digest of unequal length is not a
    // valid `timingSafeEqual` input.
    expect(apiKeyHashesEqual(hash, "abc")).toBe(false)
  })
})