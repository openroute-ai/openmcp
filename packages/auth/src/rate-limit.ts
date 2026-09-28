import type Redis from "ioredis"

export type RateLimitStorage = {
  consume: (
    key: string,
    rule: { window: number; max: number }
  ) => Promise<{ allowed: boolean; retryAfter: number | null }>
}

const INCR_AND_EXPIRE = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
if count <= tonumber(ARGV[2]) then
  return { 1, pttl }
end
return { 0, pttl }
`

/**
 * Fixed-window Redis backend for Better Auth's built-in rate limiter.
 *
 * Better Auth calls `consume" atomically per request, keyed by
 * `<ip>|<path>`. The default memory storage is per-process and collapses on
 * restart; this backend moves the counters to Redis so limits hold across
 * replicas. A Lua script makes the check-and-increment a single step so
 * concurrent requests cannot all pass a stale read.
 *
 * On a Redis outage the limiter fails open (requests allowed) so logins keep
 * working; the failure is logged once per process.
 */
export function createRedisRateLimitStorage(
  redis: Redis,
  options: { prefix?: string } = {}
): RateLimitStorage {
  const prefix = options.prefix ?? ""
  let warned = false
  const warnOnce = (error: unknown) => {
    if (warned) return
    warned = true
    console.warn(
      "[@workspace/auth] Redis rate limiter unavailable, failing open:",
      error
    )
  }

  return {
    async consume(key, { window, max }) {
      const redisKey = `${prefix}auth:rate-limit:${key}`
      try {
        const [allowed, timeToLive] = (await redis.eval(
          INCR_AND_EXPIRE,
          1,
          redisKey,
          String(window),
          String(max)
        )) as [number, number]
        return {
          allowed: allowed === 1,
          retryAfter:
            allowed === 1 ? null : Math.max(1, Math.ceil(timeToLive / 1000)),
        }
      } catch (error) {
        warnOnce(error)
        return { allowed: true, retryAfter: null }
      }
    },
  }
}
