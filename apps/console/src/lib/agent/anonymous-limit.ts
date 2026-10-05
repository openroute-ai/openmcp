/**
 * Rate limiting for the anonymous agent surface.
 *
 * The authenticated limiter in `lib/api/guard.ts` is keyed by API key id, which
 * is the right shape there because the quota was bought with a key. Nothing here
 * is bought: these reads are free and need no credential, so the quota can only
 * be per-caller-by-IP.
 *
 * It reuses `getApiRateLimiter()` rather than introducing a second limiter, so
 * the Redis Lua script, the window semantics and the `RateLimit-*` headers are
 * the same ones the keyed endpoints emit — an agent reading one set of limit
 * headers does not have to special-case which surface it hit.
 *
 * The `anon:` prefix keeps these windows in a separate namespace from `k:` and
 * `d:`. Without it, an anonymous caller and a keyholder sharing an IP would draw
 * from one budget, so a crawler would spend a paying customer's quota.
 */
import { getApiRateLimiter } from "@/lib/api/rate-limit"

/**
 * Per-IP quota for the anonymous surface.
 *
 * Deliberately looser per request than a key's default is per key: these are
 * read-only ranking and detail reads with the same ETag and cache headers the
 * keyed endpoints already send, so a well-behaved caller mostly gets 304s. The
 * ceiling exists to bound one address, not to ration normal use.
 */
export const ANONYMOUS_RPM = 60

/** A day's worth, for the same reason: bounded per address, not rationed. */
export const ANONYMOUS_RPD = 2_000

export type AnonymousLimitResult = {
  headers: Record<string, string>
  failure?: Response
}

/**
 * Consumes one request from the anonymous budget for `request`.
 *
 * `identity` is the caller's address as the edge reported it. It is trusted as
 * *a bucket name* and not as an identity: the worst a spoofed `x-forwarded-for`
 * achieves is choosing which bucket to spend, and every spoof still has to fit
 * inside some bucket's quota, so the aggregate ceiling holds.
 */
export async function consumeAnonymousRateLimit(
  request: Request,
  identity: string
): Promise<AnonymousLimitResult> {
  const limiter = getApiRateLimiter()

  const perMinute = await limiter.consume(
    `anon:k:${identity}`,
    ANONYMOUS_RPM,
    60
  )
  if (!perMinute.allowed) {
    return {
      headers: rateLimitHeaders(perMinute),
      failure: new Response(
        JSON.stringify({
          error: "rate_limited",
          message: "请求过于频繁，请稍后重试。",
          retryAfterSeconds: perMinute.retryAfter ?? 60,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": String(perMinute.retryAfter ?? 60),
            ...rateLimitHeaders(perMinute),
          },
        }
      ),
    }
  }

  const secondsIntoUtcDay = Math.floor(Date.now() / 1000) % 86_400
  const secondsUntilUtcMidnight = 86_400 - secondsIntoUtcDay

  const perDay = await limiter.consume(
    `anon:d:${identity}`,
    ANONYMOUS_RPD,
    Math.max(1, secondsUntilUtcMidnight)
  )
  if (!perDay.allowed) {
    return {
      headers: rateLimitHeaders(perDay),
      failure: new Response(
        JSON.stringify({
          error: "rate_limited",
          message: "今日请求数已用尽，明天重置。",
          retryAfterSeconds: perDay.retryAfter ?? secondsUntilUtcMidnight,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": String(perDay.retryAfter ?? secondsUntilUtcMidnight),
            ...rateLimitHeaders(perDay),
          },
        }
      ),
    }
  }

  const tightest = perMinute.remaining <= perDay.remaining ? perMinute : perDay
  return { headers: rateLimitHeaders(tightest) }
}

/**
 * The caller's address, or a shared bucket when the edge did not say.
 *
 * Collapsing "no address" onto one bucket is the conservative choice: it means a
 * deployment without `x-forwarded-for` gets one shared quota rather than an
 * unmetered surface. Deployments that intend that can put a real limiter in
 * front of this one.
 */
export function anonymousIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  return first || request.headers.get("x-real-ip")?.trim() || "unknown"
}

function rateLimitHeaders(result: {
  limit: number
  remaining: number
  resetAt: number
}): Record<string, string> {
  return {
    "ratelimit-limit": String(result.limit),
    "ratelimit-remaining": String(result.remaining),
    "ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  }
}
