/**
 * Gateway budget allocation — pure functions, no IO.
 *
 * Split out of `budget-sync.ts` because these two functions decide the money
 * safety boundary (whether a balance can be over-authorized), so they must be
 * verifiable without a database or a live LiteLLM. `budget-sync.ts` owns the
 * reads and the writes; this file only does the arithmetic.
 *
 * Currency semantics: openmcp and LiteLLM never convert currencies.
 * `available` is the raw numeric value of `balances.amountTotal` (CNY).
 */

/**
 * Budget for a single key, for the case where a user holds exactly one key.
 *
 *   max_budget = available + keySpend
 *   => max_budget - keySpend == available
 *
 * i.e. "remaining budget on the LiteLLM side equals the available balance on
 * the openmcp side".
 *
 * When the balance is <= 0 we push `blocked: true` rather than
 * `max_budget = 0`, because LiteLLM versions disagree on what 0 means (some
 * treat it as unlimited); an explicit block is reliable everywhere.
 */
export function computeKeyBudget(available: number, keySpend: number) {
  const spend = Number.isFinite(keySpend) && keySpend > 0 ? keySpend : 0
  const availableBalance = Number.isFinite(available) && available > 0 ? available : 0
  return {
    maxBudget: availableBalance + spend,
    blocked: availableBalance <= 0,
  }
}

/**
 * Shared pool allocation: treats the user balance as a **single** pool split
 * across keys.
 *
 * Giving every key its own `computeKeyBudget` grant means a user with 2 keys
 * could spend 2x their balance. This function splits by weight instead:
 *
 *   share_i     = available * (keySpend_i + BASE) / (userSpend + N * BASE)
 *   maxBudget_i = keySpend_i + share_i
 *
 * Invariant: `sum(share_i) == available`, so the total remaining allowance
 * across all keys is exactly the balance — one extra key never buys extra
 * budget.
 *
 * `BASE` is an equal-weight floor that keeps the formula well behaved at both
 * ends:
 * - Nobody has spent anything (`userSpend == 0`) -> each key gets
 *   `available / N`, an exact even split.
 * - Some spend exists -> allocation follows the spend ratio, while every key
 *   still keeps a floor of `available * BASE / (userSpend + N * BASE)`. The
 *   floor means a freshly issued, never-called key still receives a non-zero
 *   usable allowance (growing as it spends) instead of
 *   `max_budget = 0`; some LiteLLM versions read 0 as unlimited, which would
 *   hand out an uncapped card.
 *
 * `BASE = 1` (one currency unit) makes the no-spend case an exact even split
 * and serves as the magnitude reference for a minimum viable allowance.
 *
 * Rounding: allocate to 6 decimals and let the last key absorb the remainder,
 * so the sum stays exact.
 */
export const SHARED_POOL_BASE = 1

export function computeSharedPoolBudgets(
  available: number,
  entries: { keyAlias: string; keySpend: number }[]
): Map<string, { maxBudget: number; blocked: boolean }> {
  const result = new Map<string, { maxBudget: number; blocked: boolean }>()
  if (entries.length === 0) return result

  const availableBalance = Number.isFinite(available) && available > 0 ? available : 0
  const blocked = availableBalance <= 0
  // Sorting by alias keeps "who eats the remainder" deterministic instead of
  // depending on query order.
  const ordered = [...entries].sort((a, b) => a.keyAlias.localeCompare(b.keyAlias))

  const spends = ordered.map((entry) => {
    const value = Number(entry.keySpend)
    return Number.isFinite(value) && value > 0 ? value : 0
  })
  const userSpend = spends.reduce((sum, value) => sum + value, 0)
  const denominator = userSpend + ordered.length * SHARED_POOL_BASE

  let allocated = 0
  ordered.forEach((entry, index) => {
    const keySpend = spends[index] ?? 0
    const isLast = index === ordered.length - 1
    const weight = (keySpend + SHARED_POOL_BASE) / denominator
    const share = isLast ? availableBalance - allocated : roundTo(availableBalance * weight)
    allocated += share
    if (isLast) allocated = availableBalance

    result.set(entry.keyAlias, {
      maxBudget: roundTo(keySpend + share),
      blocked,
    })
  })

  return result
}

/** 6 decimals to match ledger precision; the float tail is absorbed by the last key. */
export function roundTo(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
