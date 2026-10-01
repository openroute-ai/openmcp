/**
 * A Redis lock so a scheduled task runs on one worker at a time.
 *
 * Console runs its tasks from both a Vercel cron (which fires regardless of
 * whether a previous invocation finished) and a local scheduler, so
 * `build-rankings` and `notify-subscriptions` can overlap. Overlap is not
 * merely wasteful for `notify-subscriptions`: it sends the same webhook twice
 * for the same period, and the receiving end dedupes on `X-Webhook-Id`, which
 * means the *second* copy is discarded and the first one's delivery record
 * wins. Silent, then — the symptom is a missing event rather than a doubled
 * one.
 *
 * `SET NX PX` is the acquisition because Redis makes it one atomic step. The
 * release is a Lua compare-and-delete so a holder whose lock already expired
 * cannot delete the lock a different worker now owns.
 */
import { randomUUID } from "node:crypto"
import type { RedisLike } from "./client"
import { EXTEND_LOCK, RELEASE_LOCK } from "./lua"

/** Defaults are sized for the slowest task rather than the median one. */
const DEFAULT_TTL_MS = 30 * 60 * 1000
const DEFAULT_RENEW_INTERVAL_MS = 60 * 1000

export type LockHandle = {
  key: string
  /** This holder's random token. Never sent anywhere except `RELEASE_LOCK`. */
  token: string
  /** Renews the TTL. Returns false once the lock is gone. */
  extend: (ttlMs?: number) => Promise<boolean>
  release: () => Promise<boolean>
}

export type AcquireOptions = {
  ttlMs?: number
  /** Retry this many extra times, waiting `retryDelayMs`, before giving up. */
  retries?: number
  retryDelayMs?: number
}

/**
 * Returns `null` when the lock is held elsewhere. Callers must handle that as a
 * normal "another worker got there first" outcome, not an error.
 */
export async function acquireLock(
  redis: RedisLike,
  key: string,
  options: AcquireOptions = {}
): Promise<LockHandle | null> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const retries = options.retries ?? 0
  const retryDelayMs = options.retryDelayMs ?? 1000
  const token = randomUUID()

  for (let attempt = 0; ; attempt++) {
    if (await redis.setIfAbsent(key, token, ttlMs)) {
      return createHandle(redis, key, token, ttlMs)
    }
    if (attempt >= retries) return null
    await sleep(retryDelayMs)
  }
}

function createHandle(
  redis: RedisLike,
  key: string,
  token: string,
  ttlMs: number
): LockHandle {
  let released = false
  return {
    key,
    token,
    async extend(nextTtlMs = ttlMs) {
      if (released) return false
      const result = await redis.eval(
        EXTEND_LOCK,
        [key],
        [token, String(nextTtlMs)]
      )
      return Number(result) === 1
    },
    async release() {
      if (released) return false
      released = true
      const result = await redis.eval(RELEASE_LOCK, [key], [token])
      return Number(result) === 1
    },
  }
}

/**
 * Runs `fn` under the lock, releasing it even if `fn` throws.
 *
 * Renews the TTL on an interval while `fn` runs. Without that, a task longer
 * than its TTL would lose the lock mid-run and let a second worker in — the
 * exact overlap the lock exists to prevent. A renewal failure ends the
 * interval rather than throwing, because by then the work is already
 * underway and the caller is better served by the error `fn` itself raises.
 *
 * `fn` is not called at all when the lock is unavailable; the result is
 * `undefined` rather than a sentinel, so a caller that ignores it is reading
 * this signature.
 */
export async function withLock<T>(
  redis: RedisLike,
  key: string,
  fn: () => Promise<T>,
  options: AcquireOptions & { renewIntervalMs?: number } = {}
): Promise<T | undefined> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const renewIntervalMs = options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS
  const lock = await acquireLock(redis, key, options)
  if (!lock) return undefined

  const renewer = setInterval(() => {
    void lock.extend(ttlMs).catch(() => {})
  }, renewIntervalMs)
  // Do not hold the event loop open just to renew a lock.
  renewer.unref?.()

  try {
    return await fn()
  } finally {
    clearInterval(renewer)
    await lock.release().catch(() => {})
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}