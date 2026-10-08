/**
 * One-time-code storage, shared by the flows that need one.
 *
 * The properties that make a six-digit code safe are the same in every place
 * that issues one, so they live here rather than being re-decided per flow: the
 * code is stored as a digest, keyed by a hash of the subject it belongs to, dies
 * on a short timer, and is destroyed after a handful of misses. Six digits is a
 * million candidates, so an endpoint that accepts unlimited guesses is not a
 * verification step at all.
 *
 * Redis when it is configured, process-local maps when it is not. The fallback
 * is a development convenience, not a deployment: it does not survive a restart
 * and each replica would accept a different set of codes. It exists for the
 * same reason `sendSmsCode` logs to stdout without Tencent credentials — a fresh
 * checkout should exercise the flow rather than be blocked by infrastructure —
 * and it says so in the logs while it is in use.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto"

import { getRedisClient } from "@/lib/redis/client"

export type OtpFailure = "invalid" | "expired" | "tooManyAttempts"

export type OtpResult = { ok: true } | { ok: false; reason: OtpFailure }

/** Six digits, uniformly drawn. `randomInt` is CSPRNG-backed, unlike `Math.random`. */
export function generateNumericCode(length = 6): string {
  return String(randomInt(0, 10 ** length)).padStart(length, "0")
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** `SET key value EX ttl`, which `RedisLike.set` cannot express. */
const SET_WITH_TTL =
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) return 1"

/** `INCR` plus the expiry in one step, so the counter cannot outlive the code. */
const INCR_AND_EXPIRE =
  "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n"

export interface OtpStore {
  /** Stores a code for a subject, replacing any earlier one. */
  issue(subject: string, code: string): Promise<void>
  /** Checks a code and consumes it when it is right. */
  verify(subject: string, code: string): Promise<OtpResult>
  /**
   * Takes a one-per-window slot for a subject — used to hold a resend button
   * down. Claims rather than reads, because two concurrent requests must not
   * both be told yes.
   */
  claimSlot(subject: string, windowSeconds: number): Promise<boolean>
  /** Forgets a subject's code and its attempt counter. */
  clear(subject: string): Promise<void>
}

export function createOtpStore(options: {
  /** Namespaces the keys, so two flows cannot read each other's codes. */
  namespace: string
  ttlSeconds: number
  maxAttempts: number
}): OtpStore {
  const { namespace, ttlSeconds, maxAttempts } = options
  const prefix = `openmcp:console:auth:${namespace}:`

  /** Hashed so a Redis listing does not enumerate the subjects behind the codes. */
  const keyOf = (subject: string) => prefix + digest(subject)

  const memory = new Map<string, { digest: string; expiresAt: number }>()
  const memoryAttempts = new Map<string, { count: number; expiresAt: number }>()
  /**
   * Resend cooldowns when Redis is absent.
   *
   * Without this the cooldown answered "claimed" for every request, which
   * turned the resend button into no limit at all — and since the codes
   * themselves are process-local in the same configuration, the fallback is
   * already the deployment this map belongs to. It does not make a
   * multi-instance deploy safe; that is what the warning in `issue` is for.
   */
  const memoryCooldowns = new Map<string, number>()

  function prune(now: number): void {
    for (const [key, entry] of memory) {
      if (entry.expiresAt <= now) memory.delete(key)
    }
    for (const [key, entry] of memoryAttempts) {
      if (entry.expiresAt <= now) memoryAttempts.delete(key)
    }
    for (const [key, expiresAt] of memoryCooldowns) {
      if (expiresAt <= now) memoryCooldowns.delete(key)
    }
  }

  const clear = async (subject: string): Promise<void> => {
    memory.delete(digest(subject))
    memoryAttempts.delete(digest(subject))

    const redis = getRedisClient()
    if (!redis) return
    await redis.del(keyOf(subject))
    await redis.del(prefix + "attempts:" + digest(subject))
  }

  async function bumpAttempts(subject: string): Promise<number> {
    const redis = getRedisClient()
    const now = Date.now()

    if (!redis) {
      prune(now)
      const key = digest(subject)
      const entry = memoryAttempts.get(key) ?? {
        count: 0,
        expiresAt: now + ttlSeconds * 1000,
      }
      entry.count += 1
      memoryAttempts.set(key, entry)
      return entry.count
    }

    const value = (await redis.eval(INCR_AND_EXPIRE, [prefix + "attempts:" + digest(subject)], [
      ttlSeconds,
    ])) as number
    return typeof value === "number" ? value : 0
  }

  async function read(subject: string): Promise<{ digest: string; expiresAt: number } | null> {
    const redis = getRedisClient()
    const now = Date.now()

    if (!redis) {
      prune(now)
      return memory.get(digest(subject)) ?? null
    }

    const stored = await redis.get(keyOf(subject))
    if (!stored) return null
    try {
      const parsed = JSON.parse(stored) as { digest?: string }
      // Redis enforces the expiry itself, so an entry that comes back is live.
      return parsed.digest ? { digest: parsed.digest, expiresAt: 0 } : null
    } catch {
      return null
    }
  }

  return {
    async issue(subject, code) {
      const payload = JSON.stringify({ digest: digest(code) })
      const redis = getRedisClient()

      // A fresh code starts with a fresh budget. Without this, the misses spent
      // on the previous code would carry over and could leave a brand-new code
      // permanently locked out.
      memoryAttempts.delete(digest(subject))

      if (!redis) {
        const now = Date.now()
        prune(now)
        memory.set(digest(subject), {
          digest: digest(code),
          expiresAt: now + ttlSeconds * 1000,
        })
        console.warn(
          `[console] one-time codes for "${namespace}" are held in process memory; configure Redis before running more than one instance`
        )
        return
      }

      await redis.del(prefix + "attempts:" + digest(subject))
      await redis.eval(SET_WITH_TTL, [keyOf(subject)], [payload, ttlSeconds])
    },

    async claimSlot(subject, windowSeconds) {
      const redis = getRedisClient()
      const key = digest(subject)

      if (!redis) {
        const now = Date.now()
        prune(now)
        const expiresAt = memoryCooldowns.get(key)
        if (expiresAt !== undefined && expiresAt > now) return false
        memoryCooldowns.set(key, now + windowSeconds * 1000)
        return true
      }

      return redis.setIfAbsent(prefix + "cooldown:" + key, "1", windowSeconds * 1000)
    },

    clear,

    async verify(subject, code) {
      const entry = await read(subject)

      // Nothing stored is either "never asked for one" or "expired"; which of the
      // two is not something the reader can act on differently, so both answer
      // as expired.
      if (!entry) return { ok: false, reason: "expired" }
      if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
        await clear(subject)
        return { ok: false, reason: "expired" }
      }

      if ((await bumpAttempts(subject)) > maxAttempts) {
        await clear(subject)
        return { ok: false, reason: "tooManyAttempts" }
      }

      if (!digestsMatch(entry.digest, digest(code))) {
        return { ok: false, reason: "invalid" }
      }

      // Deleted rather than marked used: a code confirms once, and leaving a
      // valid one in place would let a forwarded mailbox reuse it.
      await clear(subject)
      return { ok: true }
    },
  }
}
