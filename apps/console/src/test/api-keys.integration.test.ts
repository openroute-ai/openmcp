/**
 * Integration tests for the API key router and the HTTP guard against the same
 * database.
 *
 * The decision table for the guard lives in `api-guard.test.ts` with a fake
 * `lookup`. What only a real database can show is the part where a plaintext
 * stops being recoverable: a key issued through `apiKeys.create` must authenticate
 * afterwards, must stop authenticating the moment it is revoked, and a rotated
 * key must be the one that works. Those are properties of the rows, not of the
 * branch logic, and a fake `lookup` would let any of them regress silently.
 */
import { eq } from "drizzle-orm"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { db, pool } from "@/db/client"
import { apiKeys } from "@/db/schema/api-keys"
import { user } from "@/db/schema"
import { hashApiKey } from "@/lib/api/keys"
import { authenticateApiKey } from "@/lib/api/guard"
import { setApiRateLimiterForTests } from "@/lib/api/rate-limit"
import { ADMIN_ROLE } from "@/lib/auth/role"
import { API_KEY_PLAINTEXT_PREFIX, type ApiScope } from "@/lib/api/scopes"
import { createCaller } from "@/lib/trpc/root"
import {
  fakeAdminContext,
  fakeAnonymousContext,
  fakeUserContext,
} from "./helpers/fakes"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

/**
 * These assertions run against a remote PostgreSQL instance over the network,
 * and several cost three or four round trips: issue a key (submitter lookup,
 * insert) then authenticate it (hash, lookup). At roughly 700ms a round trip a
 * test can exceed vitest's 5s default intermittently, which reads as a product
 * failure when nothing here is timing-dependent. Set at module scope, because
 * `vi.setConfig` inside a `beforeAll` lands too late to affect the already
 * scheduled test. Scoped to this file, so the unit suites keep the default.
 */
vi.setConfig({ testTimeout: 30_000 })

/**
 * The id `fakeAdminContext` hands out.
 *
 * `api_keys.created_by` references `user.id`, so this row has to really exist
 * before a key can be issued -- a fake context with an id no account owns makes
 * every insert fail on the foreign key rather than on anything this file
 * asserts. It is seeded in `beforeAll` and removed in `afterAll`, and only
 * because a real database is shared with a real user.
 */
const TEST_USER_ID = "user-1"

/**
 * Removes only what this file created.
 *
 * `created_by = "user-1"` is the id `fakeAdminContext` hands out, so the
 * predicate cannot reach a key minted by another test or by hand. A bare
 * `delete(apiKeys)` would be simpler and would also delete a real key in a
 * database that has been used for a manual test.
 */
async function clean() {
  await db.delete(apiKeys).where(eq(apiKeys.createdBy, TEST_USER_ID))
}

/** A limiter that always allows, so rate limiting never colours a result. */
function allowAll() {
  return {
    driver: "redis" as const,
    async consume() {
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

function request(token: string) {
  return new Request("https://console.test/api/v1/repos", {
    headers: { authorization: `Bearer ${token}` },
  })
}

async function authenticate(token: string, scope?: ApiScope) {
  return authenticateApiKey(request(token), { scope })
}

/**
 * A no-owner, service-tier create input.
 *
 * `create` now requires `userId` and `tier` explicitly rather than defaulting
 * them, and that is deliberate: an admin form should have to state which of the
 * two it is doing. These tests are all about the *unowned* case, so they state it
 * here once instead of at twenty call sites -- and a reader who finds this
 * helper immediately sees that the assertions below are about service keys, not
 * user keys. The user-key path has its own `describe` block.
 */
function serviceKey(name: string, scopes: ApiScope[] = ["repos:read"]) {
  return { name, scopes, userId: null, tier: "service" as const }
}

describe.skipIf(!hasDatabase)("api keys (integration)", () => {
  const caller = createCaller(fakeAdminContext(db))

  beforeAll(async () => {
    setApiRateLimiterForTests(allowAll())
    // `onConflictDoNothing` so re-running against a database that already holds
    // the row -- from an interrupted previous run -- cannot fail on the primary
    // key.
    await db
      .insert(user)
      .values({
        id: TEST_USER_ID,
        name: "API Key Integration Test",
        email: "api-keys-integration@console.test",
        emailVerified: true,
        role: ADMIN_ROLE,
      })
      .onConflictDoNothing()
  })

  beforeEach(async () => {
    await clean()
  })

  afterAll(async () => {
    setApiRateLimiterForTests(undefined)
    await clean()
    // Keys first: `api_keys.created_by` references this row, so deleting the
    // user while a key still points at it would fail on the foreign key.
    await db.delete(user).where(eq(user.id, TEST_USER_ID))
    await pool.end()
  })

  describe("create", () => {
    it("returns a plaintext exactly once and stores only its hash", async () => {
      const issued = await caller.apiKeys.create(serviceKey("integration"))

      expect(issued.secret.startsWith(API_KEY_PLAINTEXT_PREFIX)).toBe(true)

      const [row] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, issued.id))

      expect(row).toBeDefined()
      expect(row!.keyHash).toBe(hashApiKey(issued.secret))
      expect(row!.prefix).toBe(issued.prefix)
      // The whole point of the hash: the row cannot be read back into a key.
      expect(JSON.stringify(row)).not.toContain(issued.secret)
    })

    it("gives two keys different plaintexts and different prefixes", async () => {
      const first = await caller.apiKeys.create(serviceKey("a"))
      const second = await caller.apiKeys.create(serviceKey("b"))

      expect(first.secret).not.toBe(second.secret)
      expect(first.prefix).not.toBe(second.prefix)
    })

    it("rejects a submitter that is not an account", async () => {
      await expect(
        caller.apiKeys.create({
          ...serviceKey("bad submitter"),
          submitterId: "no-such-user",
        })
      ).rejects.toThrow(/no-such-user/)
    })

    it("refuses a non-admin", async () => {
      const asUser = createCaller(fakeUserContext(db))
      await expect(asUser.apiKeys.create(serviceKey("x"))).rejects.toThrow()
    })

    it("refuses an anonymous caller", async () => {
      const asNobody = createCaller(fakeAnonymousContext(db))
      await expect(asNobody.apiKeys.create(serviceKey("x"))).rejects.toThrow()
    })
  })

  describe("authenticate with a real key", () => {
    it("accepts the plaintext it returned", async () => {
      const issued = await caller.apiKeys.create(serviceKey("usable"))

      const result = await authenticate(issued.secret, "repos:read")

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.principal.keyId).toBe(issued.id)
      expect(result.principal.scopes.has("repos:read")).toBe(true)
    })

    it("does not answer for an unknown plaintext", async () => {
      const result = await authenticate(
        `${API_KEY_PLAINTEXT_PREFIX}zzzz_unknown`
      )

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    it("does not answer for a plaintext that differs in one character", async () => {
      const issued = await caller.apiKeys.create(serviceKey("near miss"))
      const tampered = `${issued.secret.slice(0, -1)}${
        issued.secret.endsWith("a") ? "b" : "a"
      }`

      expect(tampered).not.toBe(issued.secret)
      const result = await authenticate(tampered)
      expect(result.ok).toBe(false)
    })

    it("honours a scope the key does not hold", async () => {
      const issued = await caller.apiKeys.create(serviceKey("read only"))

      const result = await authenticate(issued.secret, "repos:write")

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(403)
    })

    it("refuses an expired key", async () => {
      const issued = await caller.apiKeys.create({
        ...serviceKey("already expired"),
        expiresAt: new Date(Date.now() - 1000),
      })

      const result = await authenticate(issued.secret)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(401)
    })

    it("accepts a key whose expiry is in the future", async () => {
      const issued = await caller.apiKeys.create({
        ...serviceKey("not yet expired"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })

      const result = await authenticate(issued.secret)
      expect(result.ok).toBe(true)
    })

    it("stops authenticating the moment it is revoked", async () => {
      const issued = await caller.apiKeys.create(serviceKey("to revoke"))
      expect((await authenticate(issued.secret)).ok).toBe(true)

      await caller.apiKeys.revoke({ id: issued.id, reason: "test" })

      const result = await authenticate(issued.secret)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(401)
      const body = (await result.response.json()) as { error: { code: string } }
      expect(body.error.code).toBe("key_revoked")
    })

    it("keeps the first revocation reason when revoked twice", async () => {
      const issued = await caller.apiKeys.create(serviceKey("double revoke"))

      await caller.apiKeys.revoke({ id: issued.id, reason: "first" })
      await caller.apiKeys.revoke({ id: issued.id, reason: "second" })

      const [row] = await db
        .select({ reason: apiKeys.revokedReason })
        .from(apiKeys)
        .where(eq(apiKeys.id, issued.id))

      expect(row?.reason).toBe("first")
    })

    it("records the submitter for later attribution", async () => {
      // The submitter is `user-1`, which is the id `fakeAdminContext` carries.
      const issued = await caller.apiKeys.create({
        ...serviceKey("with submitter", ["repos:write"]),
        submitterId: "user-1",
      })

      const result = await authenticate(issued.secret)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.principal.submitterId).toBe("user-1")
    })
  })

  describe("rotate", () => {
    it("kills the old plaintext and hands back a working new one", async () => {
      const issued = await caller.apiKeys.create(serviceKey("to rotate"))

      const rotation = await caller.apiKeys.rotate({ id: issued.id })

      expect(rotation.revokedId).toBe(issued.id)
      expect(rotation.issued.secret).not.toBe(issued.secret)
      // Scopes carry over: rotation changes the secret, not the grant.
      expect(rotation.issued.scopes).toEqual(issued.scopes)

      const old = await authenticate(issued.secret)
      expect(old.ok).toBe(false)

      const fresh = await authenticate(rotation.issued.secret, "repos:read")
      expect(fresh.ok).toBe(true)
    })

    it("records the old key's revocation reason as `rotated`", async () => {
      const issued = await caller.apiKeys.create(serviceKey("rotation reason"))
      await caller.apiKeys.rotate({ id: issued.id })

      const [row] = await db
        .select({ reason: apiKeys.revokedReason })
        .from(apiKeys)
        .where(eq(apiKeys.id, issued.id))

      expect(row?.reason).toBe("rotated")
    })

    it("refuses to rotate an already-revoked key", async () => {
      const issued = await caller.apiKeys.create(
        serviceKey("rotate after revoke")
      )
      await caller.apiKeys.revoke({ id: issued.id, reason: "test" })

      await expect(caller.apiKeys.rotate({ id: issued.id })).rejects.toThrow(
        /already revoked/
      )
    })

    it("reports an unknown id rather than creating a key", async () => {
      await expect(
        caller.apiKeys.rotate({ id: "no-such-key" })
      ).rejects.toThrow(/No such API key/)
    })
  })

  describe("list", () => {
    it("hides revoked keys by default", async () => {
      const live = await caller.apiKeys.create(serviceKey("live"))
      const dead = await caller.apiKeys.create(serviceKey("dead"))
      await caller.apiKeys.revoke({ id: dead.id, reason: "test" })

      const rows = await caller.apiKeys.list({ onlyActive: true })

      expect(rows.map((row) => row.id)).toContain(live.id)
      expect(rows.map((row) => row.id)).not.toContain(dead.id)
    })

    it("shows revoked keys when asked, since that is the question an operator has", async () => {
      const dead = await caller.apiKeys.create(serviceKey("gone"))
      await caller.apiKeys.revoke({ id: dead.id, reason: "leaked" })

      const rows = await caller.apiKeys.list({ onlyActive: false })
      const found = rows.find((row) => row.id === dead.id)

      expect(found).toBeDefined()
      expect(found?.revokedReason).toBe("leaked")
    })

    it("never returns anything that could reconstruct the key", async () => {
      const issued = await caller.apiKeys.create(serviceKey("listed"))

      const rows = await caller.apiKeys.list({ onlyActive: false })
      const serialised = JSON.stringify(rows)

      expect(serialised).not.toContain(issued.secret)
      expect(serialised).not.toContain(hashApiKey(issued.secret))
      // `prefix` is safe to expose and is meant to be shown.
      expect(serialised).toContain(issued.prefix)
    })
  })
})
