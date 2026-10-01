/**
 * Lua shared by the Redis-backed rate limiter and the distributed lock.
 *
 * Both live here rather than inline because they encode the same two ideas: a
 * check and a write must be one step, and the release must verify it is
 * releasing its own write. A limiter written as `INCR` then `EXPIRE` in two
 * round-trips lets a crash between them leave a counter with no TTL, which
 * reads as a permanently exhausted quota; a lock released by `DEL` alone lets
 * one holder delete another's lock after its own expired.
 */

/**
 * Fixed-window rate limit. Returns `{ allowed, ttl_ms, count }`, where `ttl_ms`
 * is the remaining lifetime of the window and `count` is this window's tally
 * after the increment.
 *
 * The count is returned rather than derived by the caller. `allowed` alone is
 * a boolean, so a caller wanting `RateLimit-Remaining` would have to infer it,
 * and the only way to do that is to mistake `allowed` (always 1) for the count —
 * which reports a full quota left on the last request before a `429`.
 *
 * Fixed rather than sliding because this is the algorithm the app's existing
 * Better Auth limiter uses, and two windowing schemes in one app means two
 * things to reason about when someone asks why their client saw `429`. The
 * cost is a boundary burst: a client can spend `max` just before the window
 * rolls and `max` just after. For a per-key API quota that is acceptable; for a
 * per-IP sign-in limit it is not, which is a different limiter in a different
 * file.
 */
export const FIXED_WINDOW_RATE_LIMIT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
if count <= tonumber(ARGV[2]) then
  return { 1, pttl, count }
end
return { 0, pttl, count }
`

/**
 * Releases a lock only if the caller still owns it. `DEL` alone would let a
 * caller whose lock had already expired delete the lock a different caller now
 * holds, which turns a slow task into two concurrent tasks.
 *
 * Returns 1 when released, 0 when the lock was someone else's (or gone).
 */
export const RELEASE_LOCK = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

/**
 * Extends a lock's TTL only while the caller still owns it. Used by the task
 * runner to renew a long job's lease; without it a task that outlives its TTL
 * has its lock expire mid-run and a second worker starts alongside it.
 */
export const EXTEND_LOCK = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`