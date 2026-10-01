/**
 * The Redis surface the API limiter and the task lock actually use, behind one
 * interface so the open API works on a self-hosted Redis and on Vercel's
 * Upstash without either leaking into calling code.
 *
 * The two drivers disagree on `eval`'s signature — ioredis takes
 * `(script, numKeys, ...args)` and Upstash takes `(script, keys, args)` — so
 * they cannot both satisfy a type that mirrors either one. `RedisLike` is
 * therefore declared at the *semantic* level (`eval` with keys and args
 * separated) and each driver gets a thin adapter below. The alternative, typing
 * `RedisLike` as `Pick<Redis, ...>` and casting Upstash into it, moves the
 * mismatch to runtime as a silently malformed `EVAL`.
 */
import Redis from "ioredis"
import { Redis as UpstashRedis } from "@upstash/redis"

export type RedisDriver = "ioredis" | "upstash"

export type RedisLike = {
  /** Which backend this is, for logs and tests. */
  readonly driver: RedisDriver
  /**
   * Runs `script` with `keys` and `args` kept apart, the way Redis itself wants
   * them. Callers pass `KEYS[n]` / `ARGV[n]` positions accordingly.
   */
  eval(
    script: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<unknown>
  /** Plain `SET`. Overwrites unconditionally. */
  set(key: string, value: string): Promise<void>
  /**
   * `SET key value NX PX ttl`. Resolves `true` when the key was created,
   * `false` when it already existed. This is the mutual exclusion in the lock.
   */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>
  get(key: string): Promise<string | null>
  del(key: string): Promise<void>
  /** Remaining TTL in ms; -1 when the key has no TTL, -2 when absent. */
  pttl(key: string): Promise<number>
  quit(): Promise<void>
}

function toIoredisLike(redis: Redis): RedisLike {
  return {
    driver: "ioredis",
    eval: (script, keys, args) =>
      redis.eval(script, keys.length, ...keys, ...args) as Promise<unknown>,
    set: async (key, value) => {
      await redis.set(key, value)
    },
    setIfAbsent: async (key, value, ttlMs) => {
      // `OK`/`null` rather than a count: with NX Redis answers `OK` on write and
      // a null bulk string on skip.
      const result = await redis.set(key, value, "PX", ttlMs, "NX")
      return result === "OK"
    },
    get: (key) => redis.get(key),
    del: async (key) => {
      await redis.del(key)
    },
    pttl: (key) => redis.pttl(key),
    quit: async () => {
      await redis.quit()
    },
  }
}

function toUpstashLike(redis: UpstashRedis): RedisLike {
  return {
    driver: "upstash",
    eval: (script, keys, args) =>
      redis.eval(script, keys, args) as Promise<unknown>,
    set: async (key, value) => {
      await redis.set(key, value)
      // Upstash types `set` as resolving the raw `OK`. The value is unused, so
      // it is dropped here rather than widening `RedisLike.set` to a string.
    },
    setIfAbsent: async (key, value, ttlMs) => {
      // Upstash takes the expiry as a duration string (`"5000 ms"`); it has no
      // bare `PX` flag, so the value is sent already tagged.
      const result = await redis.set(key, value, { nx: true, px: ttlMs })
      return result === "OK"
    },
    get: (key) => redis.get<string>(key),
    del: async (key) => {
      await redis.del(key)
    },
    pttl: (key) => redis.pttl(key),
    quit: async () => {
      // Upstash is HTTP per call and holds no socket; there is nothing to close.
    },
  }
}

/**
 * Upstash wins when both are configured. On Vercel the only Redis reachable is
 * the REST one, and `REDIS_*` tends to be left over from local `.env` files —
 * preferring ioredis there would mean every request blocks on a connect
 * timeout to `localhost` before falling back.
 */
function pickDriver(): RedisDriver | null {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return "upstash"
  }
  return resolveSelfHostedUrl() ? "ioredis" : null
}

function resolveSelfHostedUrl(): string | undefined {
  const { REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = process.env
  if (REDIS_URL) return REDIS_URL
  if (REDIS_HOST || REDIS_PORT || REDIS_PASSWORD) {
    const auth = REDIS_PASSWORD ? `:${encodeURIComponent(REDIS_PASSWORD)}@` : ""
    return `redis://${auth}${REDIS_HOST ?? "localhost"}:${REDIS_PORT ?? "6379"}`
  }
  return undefined
}

let cached: RedisLike | null | undefined

/**
 * The shared client, created on first use. `null` means no Redis is configured
 * at all — callers decide whether that is fatal (a task lock must not run
 * unguarded) or degradable (a rate limit can fall back to per-process).
 *
 * Separate from `getRedis()` in `lib/redis.ts`, which hands an `ioredis` to
 * `@workspace/sms-captcha` and therefore cannot return an Upstash instance.
 */
export function getRedisClient(): RedisLike | null {
  if (cached !== undefined) return cached
  const driver = pickDriver()
  if (driver === null) {
    cached = null
    return cached
  }

  if (driver === "upstash") {
    cached = toUpstashLike(
      new UpstashRedis({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
      })
    )
    return cached
  }

  const redis = new Redis(resolveSelfHostedUrl()!, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: () => null,
  })
  redis.on("error", (error) => {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      console.warn("[console] Redis:", error.message)
    }
  })
  cached = toIoredisLike(redis)
  return cached
}

/** Test seam: drops the memoised client so a test can change env and re-resolve. */
export function resetRedisClientForTests(): void {
  cached = undefined
}