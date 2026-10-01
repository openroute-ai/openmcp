/**
 * Tests for the Redis-shaped pieces that do not need a Redis.
 *
 * Both the lock and the limiter are exercised against a fake `RedisLike` rather
 * than a live server, because the behaviour worth testing here is the logic
 * around Redis, not Redis: that a release cannot delete someone else's lock,
 * that a renewal stops once the lock is gone, and that the memory limiter's
 * accounting matches the Lua's. A live server would additionally make these
 * tests fail whenever a developer's local Redis is down, which is the wrong
 * reason for a unit test to fail.
 */
import { describe, expect, it } from "vitest"
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimitResult,
} from "@/lib/api/rate-limit"
import type { RedisLike } from "@/lib/redis/client"
import {
  EXTEND_LOCK,
  FIXED_WINDOW_RATE_LIMIT,
  RELEASE_LOCK,
} from "@/lib/redis/lua"
import { acquireLock, withLock } from "@/lib/redis/lock"

/**
 * A `RedisLike` with just enough behaviour to exercise the callers: Lua scripts
 * are recognised by a substring and run through hand-written logic, so a test
 * that passes proves the script name and argument order are right without a
 * server interpreting the script itself.
 */
function createFakeRedis(options: { failEval?: boolean } = {}) {
  const store = new Map<string, { value: string; pttl: number }>()
  const calls: { script: string; keys: string[]; args: (string | number)[] }[] = []

  const redis: RedisLike = {
    driver: "ioredis",
    async eval(script, keys, args) {
      calls.push({ script, keys, args })
      if (options.failEval) throw new Error("connection refused")
      // Every script here takes exactly one key; the fake is only used with
      // scripts the production code writes, so a missing key is a test bug.
      const key = keys[0]!
      if (script === FIXED_WINDOW_RATE_LIMIT) {
        const windowSec = Number(args[0])
        const max = Number(args[1])
        const now = Date.now()
        const entry = store.get(key)
        const current = entry && entry.pttl > now ? entry : undefined
        const count = (current ? Number(current.value) : 0) + 1
        const pttl = current ? current.pttl - now : windowSec * 1000
        store.set(key, { value: String(count), pttl: now + pttl })
        return [count <= max ? 1 : 0, pttl, count]
      }
      if (script === RELEASE_LOCK) {
        const entry = store.get(key)
        if (entry && entry.value === String(args[0])) {
          store.delete(key)
          return 1
        }
        return 0
      }
      if (script === EXTEND_LOCK) {
        const entry = store.get(key)
        if (entry && entry.value === String(args[0])) {
          entry.pttl = Date.now() + Number(args[1])
          return 1
        }
        return 0
      }
      throw new Error(`unexpected script: ${script}`)
    },
    async set(key, value) {
      store.set(key, { value, pttl: Number.POSITIVE_INFINITY })
    },
    async setIfAbsent(key, value, ttlMs) {
      const now = Date.now()
      const entry = store.get(key)
      if (entry && entry.pttl > now) return false
      store.set(key, { value, pttl: now + ttlMs })
      return true
    },
    async get(key) {
      return store.get(key)?.value ?? null
    },
    async del(key) {
      store.delete(key)
    },
    async pttl(key) {
      const entry = store.get(key)
      if (!entry) return -2
      return entry.pttl === Number.POSITIVE_INFINITY
        ? -1
        : entry.pttl - Date.now()
    },
    async quit() {},
  }

  return { redis, store, calls }
}

describe("acquireLock", () => {
  it("grants the lock to the first caller and refuses the second", async () => {
    const { redis } = createFakeRedis()

    const first = await acquireLock(redis, "lock:build-rankings")
    const second = await acquireLock(redis, "lock:build-rankings")

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it("retries up to the configured count before giving up", async () => {
    const { redis } = createFakeRedis()
    await acquireLock(redis, "lock:x")

    const result = await acquireLock(redis, "lock:x", {
      retries: 2,
      retryDelayMs: 1,
    })

    expect(result).toBeNull()
  })

  it("does not let a stale holder delete the lock another worker now owns", async () => {
    const { redis } = createFakeRedis()
    const first = await acquireLock(redis, "lock:x")

    // The lock expired out from under `first`, exactly as a crashed worker's
    // lock does, and a second worker took it.
    await redis.set("lock:x", "someone-else")
    const released = await first!.release()

    expect(released).toBe(false)
    expect(await redis.get("lock:x")).toBe("someone-else")
  })

  it("stops renewing once released", async () => {
    const { redis } = createFakeRedis()
    const lock = await acquireLock(redis, "lock:x")

    expect(await lock!.extend(1000)).toBe(true)
    await lock!.release()

    expect(await lock!.extend(1000)).toBe(false)
  })
})

describe("withLock", () => {
  it("runs the function and releases the lock afterwards", async () => {
    const { redis } = createFakeRedis()

    const result = await withLock(redis, "lock:x", async () => "done")

    expect(result).toBe("done")
    expect(await redis.get("lock:x")).toBeNull()
  })

  it("releases the lock when the function throws", async () => {
    const { redis } = createFakeRedis()

    await expect(
      withLock(redis, "lock:x", async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")

    // A lock leaked on failure is the worst kind: the task never runs again.
    expect(await redis.get("lock:x")).toBeNull()
  })

  it("skips the function entirely when the lock is held elsewhere", async () => {
    const { redis } = createFakeRedis()
    await acquireLock(redis, "lock:x")
    let ran = false

    const result = await withLock(redis, "lock:x", async () => {
      ran = true
      return "done"
    })

    expect(result).toBeUndefined()
    expect(ran).toBe(false)
  })
})

describe("createRedisRateLimiter", () => {
  it("allows up to the limit then reports the wait", async () => {
    const { redis, calls } = createFakeRedis()
    const limiter = createRedisRateLimiter(redis, { prefix: "test:" })

    const results: RateLimitResult[] = []
    for (let i = 0; i < 3; i++) {
      results.push(await limiter.consume("key-1", 2, 60))
    }

    const [, second, third] = results
    expect(results.map((r) => r.allowed)).toEqual([true, true, false])
    expect(second!.remaining).toBe(0)
    expect(third!.retryAfter).toBeGreaterThan(0)
    expect(third!.retryAfter).toBeLessThanOrEqual(60)
    // One key per client, so two clients do not share a budget.
    expect(
      new Set(calls.map((call) => call.keys[0])).size
    ).toBe(1)
  })

  it("keys the window per caller", async () => {
    const { redis } = createFakeRedis()
    const limiter = createRedisRateLimiter(redis, { prefix: "test:" })

    await limiter.consume("key-1", 1, 60)
    const other = await limiter.consume("key-2", 1, 60)

    expect(other.allowed).toBe(true)
  })

  it("namespaces keys with the given prefix", async () => {
    const { redis, calls } = createFakeRedis()
    const limiter = createRedisRateLimiter(redis, { prefix: "openmcp:console:" })

    await limiter.consume("key-1", 1, 60)

    expect(calls[0]!.keys[0]).toBe("openmcp:console:api:rate-limit:key-1")
  })

  it("fails open when Redis errors, so an outage does not take the API down", async () => {
    const { redis } = createFakeRedis({ failEval: true })
    const limiter = createRedisRateLimiter(redis)

    const result = await limiter.consume("key-1", 1, 60)

    expect(result.allowed).toBe(true)
    expect(result.retryAfter).toBeNull()
  })
})

describe("createMemoryRateLimiter", () => {
  it("counts the same way the Redis driver does", async () => {
    const limiter = createMemoryRateLimiter()

    const results: RateLimitResult[] = []
    for (let i = 0; i < 3; i++) {
      results.push(await limiter.consume("key-1", 2, 60))
    }

    const [first, , third] = results
    expect(results.map((r) => r.allowed)).toEqual([true, true, false])
    expect(first!.remaining).toBe(1)
    expect(third!.remaining).toBe(0)
  })

  it("keys per caller", async () => {
    const limiter = createMemoryRateLimiter()

    expect((await limiter.consume("a", 1, 60)).allowed).toBe(true)
    expect((await limiter.consume("b", 1, 60)).allowed).toBe(true)
    expect((await limiter.consume("a", 1, 60)).allowed).toBe(false)
  })
})