/**
 * Per-API-key rate limiting for `/api/v1`.
 *
 * Deliberately not the Better Auth limiter in `lib/rate-limit.ts`. That one is
 * keyed by `<ip>|<path>` because it guards a sign-in form, and its quota has to
 * be per-IP to be worth anything: the thing being protected is a password
 * guess. Here the protected thing is a quota *bought* with a key, so the limit
 * belongs to the key. Sharing one limiter would also have meant moving sign-in
 * onto Upstash as a side effect, which is a behaviour change nobody asked for.
 */
import type { RedisLike } from "@/lib/redis/client"
import { getRedisClient } from "@/lib/redis/client"
import { FIXED_WINDOW_RATE_LIMIT } from "@/lib/redis/lua"

/** Matches the `RateLimit-Remaining` / `RateLimit-Reset` shape RFC 9331 uses. */
export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  /** Seconds until the window rolls; absent when allowed. */
  retryAfter: number | null
  resetAt: number
}

export type RateLimiter = {
  consume: (key: string, limit: number, windowSec: number) => Promise<RateLimitResult>
  driver: "redis" | "memory"
}

/** Thrown on the memory driver's path so a misconfigured deploy is visible. */
export const NO_REDIS_WARNING =
  "[console] No Redis configured (KV_REST_API_URL or REDIS_*); API rate limiting is per-process. " +
  "Every replica counts separately, so a scaled deploy is enforcing N times the intended limit."

export function createRedisRateLimiter(
  redis: RedisLike,
  options: { prefix?: string } = {}
): RateLimiter {
  const prefix = options.prefix ?? "openmcp:console:"
  let warned = false

  return {
    driver: "redis",
    async consume(key, limit, windowSec) {
      const redisKey = `${prefix}api:rate-limit:${key}`
      try {
        const raw = (await redis.eval(
          FIXED_WINDOW_RATE_LIMIT,
          [redisKey],
          [windowSec, limit]
        )) as [number, number, number]
        const [allowed, pttl, count] = raw
        const isAllowed = Number(allowed) === 1
        // A window with no TTL left returns -1; treat the window as over rather
        // than reporting a negative reset.
        const remainingMs = pttl > 0 ? pttl : windowSec * 1000
        return {
          allowed: isAllowed,
          limit,
          // From the script's count, not from `allowed`: on the last request
          // before a `429`, `allowed` is 1 and the quota is in fact spent.
          remaining: Math.max(0, limit - Number(count)),
          retryAfter: isAllowed ? null : Math.max(1, Math.ceil(remainingMs / 1000)),
          resetAt: Date.now() + remainingMs,
        }
      } catch (error) {
        // Fails open, for the same reason as the auth limiter: a Redis blip
        // should not take the public API down. Logged once, because an outage
        // emits one error per request and the volume hides the cause.
        if (!warned) {
          warned = true
          console.warn("[console] API rate limiter unavailable, failing open:", error)
        }
        return {
          allowed: true,
          limit,
          remaining: limit,
          retryAfter: null,
          resetAt: Date.now() + windowSec * 1000,
        }
      }
    },
  }
}

/**
 * Per-process fallback for local development and tests.
 *
 * It is not a scaled substitute: counts reset on restart and each replica keeps
 * its own. `getApiRateLimiter()` warns once when this is what a deploy is
 * running on, so the difference between "no limit" and "a limit that happens
 * to be per-process" does not have to be guessed at.
 */
export function createMemoryRateLimiter(): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return {
    driver: "memory",
    async consume(key, limit, windowSec) {
      const now = Date.now()
      const current = windows.get(key)
      const entry = !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowSec * 1000 }
        : current

      entry.count += 1
      windows.set(key, entry)

      // A long-lived process would otherwise accumulate one key per client
      // forever. Expired entries are the only ones swept, so the sweep cannot
      // drop a live window.
      if (windows.size > 10_000) {
        for (const [existingKey, value] of windows) {
          if (value.resetAt <= now) windows.delete(existingKey)
        }
      }

      const allowed = entry.count <= limit
      return {
        allowed,
        limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfter: allowed ? null : Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        resetAt: entry.resetAt,
      }
    },
  }
}

let cached: RateLimiter | undefined

/**
 * Injection point for tests.
 *
 * A module-level spy would not work here: `guard.ts` holds a live binding to
 * `getApiRateLimiter`, so replacing the export after the fact leaves the guard
 * calling the original — and a test that then asserts on a `429` from a stub
 * would quietly be asserting on the real counter instead. Setting the value
 * here reaches the same object both modules read.
 */
export function setApiRateLimiterForTests(limiter: RateLimiter | undefined): void {
  cached = limiter
}

export function getApiRateLimiter(): RateLimiter {
  if (cached) return cached
  const redis = getRedisClient()
  if (!redis) {
    console.warn(NO_REDIS_WARNING)
    cached = createMemoryRateLimiter()
    return cached
  }
  cached = createRedisRateLimiter(redis)
  return cached
}

/** Test seam. */
export function resetApiRateLimiterForTests(): void {
  cached = undefined
}