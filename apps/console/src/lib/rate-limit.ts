/**
 * Fixed-window Redis rate-limit storage for Better Auth.
 *
 * Console owns this rather than importing it from `@workspace/auth`: console
 * runs against its own database with its own user table, so it does not share
 * an identity surface with `web`/`api` and has no reason to share their
 * limiter either. The counters were already namespaced per app
 * (`openmcp:console:`), so this split costs no isolation — what it removes is
 * the last compile-time link between console's sign-in path and another app's
 * auth package.
 *
 * Better Auth calls `consume` once per request, keyed by `<ip>|<path>`. The
 * default memory storage is per-process, so limits reset on restart and are
 * counted separately by every replica; Redis keeps them shared. A Lua script
 * makes the check-and-increment one step, so concurrent requests cannot all pass
 * against the same stale count.
 */
import type Redis from "ioredis"
import { FIXED_WINDOW_RATE_LIMIT } from "@/lib/redis/lua"

export type RateLimitStorage = {
  consume: (
    key: string,
    rule: { window: number; max: number }
  ) => Promise<{ allowed: boolean; retryAfter: number | null }>
}

/** Shared with `lib/api/rate-limit.ts`, which keys on the API key instead. */
const INCR_AND_EXPIRE = FIXED_WINDOW_RATE_LIMIT

/**
 * On a Redis outage this fails open — requests are allowed — so a Redis blip
 * cannot lock every user out of signing in. The trade-off is that a sustained
 * outage removes the limit entirely, which is why the failure is logged rather
 * than swallowed: silent, it would look like a working limiter. Logged once per
 * process, because a Redis outage produces one error per request.
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
    console.warn("[console] Redis rate limiter unavailable, failing open:", error)
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
