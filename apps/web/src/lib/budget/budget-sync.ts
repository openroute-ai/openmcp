/**
 * Gateway budget bridge: syncs the openmcp balance into a LiteLLM `max_budget`.
 *
 * Currency semantics (important): openmcp and LiteLLM never convert currencies.
 * The raw numeric value of `balances.amountTotal` (CNY) is written straight
 * into LiteLLM's `max_budget`; LiteLLM's internal USD-oriented semantics are
 * deliberately ignored and both sides reconcile on the same raw numbers.
 *
 * Budget allocation arithmetic lives in `@workspace/litellm` (`budget-alloc`),
 * where it is testable without a database or a live gateway. This module owns
 * the reads and the writes.
 */

import { and, eq } from 'drizzle-orm'
import { computeKeyBudget, computeSharedPoolBudgets, getVirtualKeyManager, isLiteLLMConfigured } from '@workspace/litellm'
import { apiKeys, balances } from '@workspace/db'
import { db } from '@/lib/db'

/** The only fields of a LiteLLM key row we care about. */
interface RemoteKeyRow {
  key_alias?: string | null
  spend?: number | null
  max_budget?: number | null
  blocked?: boolean | null
}

/** Sync outcome for a single key. */
export interface KeyBudgetSyncItem {
  apiKeyId: string
  keyAlias: string
  /** Gateway-side spend before this sync. */
  keySpend: number
  /** The `max_budget` we pushed (available + keySpend). */
  targetMaxBudget: number
  /** The blocked state we pushed. */
  targetBlocked: boolean
  /** Current gateway-side `max_budget`; null means never set. */
  previousMaxBudget: number | null
  previousBlocked: boolean | null
  changed: boolean
  success: boolean
  error?: string
}

export interface BudgetSyncResult {
  /** True when LiteLLM is not configured; callers should read this as "nothing happened", not as a failure. */
  skipped: boolean
  skipReason?: string
  userId?: string
  /** Available balance on the openmcp side (raw CNY value). */
  available: string
  keys: KeyBudgetSyncItem[]
  updated: number
  failed: number
  success: boolean
}

const EMPTY_RESULT = (reason: string, userId?: string): BudgetSyncResult => ({
  skipped: true,
  skipReason: reason,
  userId,
  available: '0',
  keys: [],
  updated: 0,
  failed: 0,
  success: true,
})

/**
 * Read the available openmcp balance.
 *
 * Field semantics: on recharge `amountTotal` grows together with `amount`, and
 * on a Skill purchase both shrink, so with the current code it is the *current
 * available balance* rather than the cumulative
 * `amount + amountGifted - amountSpend` described in the schema comment. This
 * module follows the actual behaviour.
 */
export async function readAvailableBalance(userId: string): Promise<string> {
  const [row] = await db
    .select({ amountTotal: balances.amountTotal })
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1)

  const raw = row?.amountTotal ?? '0'
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? String(parsed) : '0'
}

/** All local index rows for this user that carry a keyAlias (provider filtering happens at the call site). */
async function listLocalGatewayKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      keyAlias: apiKeys.keyAlias,
      provider: apiKeys.provider,
      metadata: apiKeys.metadata,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
}

/**
 * Budget mirror, written into `api_keys.metadata` so the panel can render
 * without querying the gateway.
 */
export interface KeyBudgetMeta {
  maxBudget: number
  keySpend: number
  blocked: boolean
  available: string
  syncedAt: string
}

export function readBudgetMeta(metadata: unknown): KeyBudgetMeta | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const raw = (metadata as Record<string, unknown>).gatewayBudget
  if (typeof raw !== 'object' || raw === null) return null
  const typed = raw as Partial<KeyBudgetMeta>
  if (typeof typed.maxBudget !== 'number' || typeof typed.blocked !== 'boolean') return null
  return {
    maxBudget: typed.maxBudget,
    keySpend: typeof typed.keySpend === 'number' ? typed.keySpend : 0,
    blocked: typed.blocked,
    available: typeof typed.available === 'string' ? typed.available : '0',
    syncedAt: typeof typed.syncedAt === 'string' ? typed.syncedAt : '',
  }
}

/** Best-effort persistence: a write failure must not change the sync verdict. */
async function writeBudgetMeta(apiKeyId: string, current: unknown, meta: KeyBudgetMeta): Promise<void> {
  try {
    const base = typeof current === 'object' && current !== null ? { ...(current as Record<string, unknown>) } : {}
    await db
      .update(apiKeys)
      .set({ metadata: { ...base, gatewayBudget: meta }, updatedAt: new Date() })
      .where(eq(apiKeys.id, apiKeyId))
  } catch (error) {
    console.error('[budget-sync] Failed to persist budget metadata:', apiKeyId, error)
  }
}

/**
 * Fetch this user's key state on the LiteLLM side, indexed by key_alias.
 *
 * Returns `null` when the **list read failed**, which callers must treat
 * differently from "read an empty list". Pushing `max_budget = available`
 * after a failed read would erase the `keySpend` already consumed, granting
 * the user more than they own — strictly worse than not syncing.
 */
async function fetchRemoteKeys(userId: string): Promise<Map<string, RemoteKeyRow> | null> {
  const result = new Map<string, RemoteKeyRow>()
  try {
    const response = await getVirtualKeyManager().getKeyList({
      user_id: userId,
      page: 1,
      size: 100,
    })
    const rows = Array.isArray(response?.keys) ? (response.keys as unknown[]) : []
    for (const row of rows) {
      // /key/list can return a string array in some response shapes.
      if (typeof row !== 'object' || row === null) continue
      const typed = row as RemoteKeyRow
      if (typed.key_alias) {
        result.set(typed.key_alias, typed)
      }
    }
    return result
  } catch (error) {
    console.error('[budget-sync] Failed to list gateway keys:', userId, error)
    return null
  }
}

/**
 * Push the user's balance into `max_budget` / `blocked` on every gateway key
 * they own.
 *
 * With a single key this equals `max_budget = available + keySpend`; with
 * several keys it uses the `computeSharedPoolBudgets` shared pool, whose
 * allowances sum to exactly the balance.
 *
 * Idempotent: repeated calls produce the same result, no cursor or incremental
 * accounting needed. Failures never break the caller (recharge, etc.); the
 * manual sync and the backfill job are the safety net.
 */
export async function syncUserGatewayBudget(userId: string): Promise<BudgetSyncResult> {
  if (!userId) {
    return EMPTY_RESULT('missing userId')
  }
  if (!isLiteLLMConfigured()) {
    return EMPTY_RESULT('LiteLLM not configured', userId)
  }

  const localKeys = await listLocalGatewayKeys(userId)
  // Only provider='litellm' rows have a usable keyAlias; locally issued keys
  // take no part in the gateway budget.
  const gatewayKeys = localKeys.filter(
    (row): row is { id: string; keyAlias: string; provider: string; metadata: unknown } =>
      row.provider === 'litellm' && row.keyAlias != null && row.keyAlias.length > 0
  )

  const availableStr = await readAvailableBalance(userId)
  const available = Number(availableStr)

  if (gatewayKeys.length === 0) {
    return {
      skipped: true,
      skipReason: 'no gateway keys',
      userId,
      available: availableStr,
      keys: [],
      updated: 0,
      failed: 0,
      success: true,
    }
  }

  const remote = await fetchRemoteKeys(userId)

  // The shared pool needs every key's spend before it can allocate, so resolve
  // them all first, then push in one pass.
  const resolved = gatewayKeys.map((local) => {
    const remoteRow = remote?.get(local.keyAlias)
    const localMeta = readBudgetMeta(local.metadata)
    // When the gateway spend cannot be read, fall back to the value recorded at
    // the last sync: under-syncing is safer than over-authorizing.
    const knownSpend = remoteRow ? Number(remoteRow.spend ?? 0) : (localMeta?.keySpend ?? 0)
    const keySpend = Number(knownSpend)
    return {
      local,
      localMeta,
      remoteRow,
      keySpend: Number.isFinite(keySpend) && keySpend > 0 ? keySpend : 0,
    }
  })

  const budgets = computeSharedPoolBudgets(
    available,
    resolved.map((row) => ({ keyAlias: row.local.keyAlias, keySpend: row.keySpend }))
  )

  const items: KeyBudgetSyncItem[] = []
  let updated = 0
  let failed = 0

  for (const row of resolved) {
    const { local, localMeta, remoteRow, keySpend } = row
    const target = budgets.get(local.keyAlias) ?? computeKeyBudget(available, keySpend)
    const { maxBudget, blocked } = target
    const previousMaxBudget = remoteRow && remoteRow.max_budget != null ? Number(remoteRow.max_budget) : null
    const previousBlocked = remoteRow?.blocked != null ? Boolean(remoteRow.blocked) : null

    const item: KeyBudgetSyncItem = {
      apiKeyId: local.id,
      keyAlias: local.keyAlias,
      keySpend,
      targetMaxBudget: maxBudget,
      targetBlocked: blocked,
      previousMaxBudget,
      previousBlocked,
      changed: false,
      success: true,
    }

    // When the list read failed we cannot confirm the gateway's current value,
    // so only write blind if we hold no local record; otherwise leave it for
    // the next trigger rather than clobbering an unknown state.
    const canTrustRemote = remote !== null
    const previousKnown = previousMaxBudget ?? localMeta?.maxBudget ?? null
    if (canTrustRemote && previousKnown !== null && previousKnown === maxBudget && previousBlocked === blocked) {
      items.push(item)
      continue
    }
    if (!canTrustRemote && localMeta !== null) {
      item.success = false
      item.error = 'Could not read gateway key state; skipped to avoid overwriting an unknown budget'
      failed += 1
      items.push(item)
      continue
    }

    try {
      await getVirtualKeyManager().updateKeyByAlias(local.keyAlias, {
        max_budget: maxBudget,
        blocked,
      })
      item.changed = true
      updated += 1
      await writeBudgetMeta(local.id, local.metadata, {
        maxBudget,
        keySpend,
        blocked,
        available: availableStr,
        syncedAt: new Date().toISOString(),
      })
    } catch (error) {
      item.success = false
      item.error = error instanceof Error ? error.message : String(error)
      failed += 1
      console.error('[budget-sync] Failed to update key budget:', local.keyAlias, error)
    }

    items.push(item)
  }

  return {
    skipped: false,
    userId,
    available: availableStr,
    keys: items,
    updated,
    failed,
    success: failed === 0,
  }
}

/**
 * Budget parameters handed straight to `/key/generate` when issuing a key.
 *
 * A new key's `spend` is always 0, so it must not simply be granted
 * `available` — that would resurrect the v1.0 flaw where every key enjoys its
 * own full copy of the balance. Instead the new key joins the user's existing
 * pool and takes a share, so "the sum of all allowances equals the balance"
 * holds from the moment of issuance.
 *
 * When nobody in the pool has spent anything the split is even by
 * `SHARED_POOL_BASE`, so the first key receives the whole balance (equivalent
 * to `computeKeyBudget(available, 0)`) and later keys get an even share.
 */
export async function getNewKeyBudgetParams(userId: string): Promise<{ max_budget: number; blocked: boolean }> {
  const availableStr = await readAvailableBalance(userId)
  const available = Number(availableStr)

  const localKeys = await listLocalGatewayKeys(userId)
  const gatewayKeys = localKeys.filter(
    (row): row is { id: string; keyAlias: string; provider: string; metadata: unknown } =>
      row.provider === 'litellm' && row.keyAlias != null && row.keyAlias.length > 0
  )

  if (gatewayKeys.length === 0) {
    const { maxBudget, blocked } = computeKeyBudget(available, 0)
    return { max_budget: maxBudget, blocked }
  }

  const remote = await fetchRemoteKeys(userId)
  const existing = gatewayKeys.map((local) => {
    const remoteRow = remote?.get(local.keyAlias)
    const localMeta = readBudgetMeta(local.metadata)
    const known = remoteRow ? Number(remoteRow.spend ?? 0) : (localMeta?.keySpend ?? 0)
    return {
      keyAlias: local.keyAlias,
      keySpend: Number.isFinite(known) && known > 0 ? known : 0,
    }
  })

  // A placeholder alias stands in for the key about to be issued; its spend is
  // always 0.
  const budgets = computeSharedPoolBudgets(available, [...existing, { keyAlias: '\u0000__new__', keySpend: 0 }])

  const target = budgets.get('\u0000__new__')
  return { max_budget: target ? target.maxBudget : 0, blocked: target ? target.blocked : true }
}

/**
 * Backfill / self-heal: give a batch of existing users a `max_budget`.
 *
 * Intended to cover keys issued before the budget fields existed, and usable
 * as a periodic self-heal job. With `onlyUnset`, keys that already carry a
 * non-null `max_budget` on the gateway are skipped to avoid pointless writes.
 */
export async function syncGatewayBudgetForUsers(
  userIds: string[],
  options: { onlyUnset?: boolean } = {}
): Promise<{
  total: number
  synced: number
  skipped: number
  failed: number
  details: BudgetSyncResult[]
}> {
  const unique = Array.from(new Set(userIds.filter(Boolean)))
  const details: BudgetSyncResult[] = []
  let synced = 0
  let skipped = 0
  let failed = 0

  for (const userId of unique) {
    const result = await syncUserGatewayBudget(userId)
    if (result.skipped) {
      skipped += 1
      continue
    }

    if (options.onlyUnset) {
      const needsWork = result.keys.some(
        (item) => item.previousMaxBudget === null || item.previousMaxBudget !== item.targetMaxBudget
      )
      if (!needsWork) {
        skipped += 1
        continue
      }
    }

    if (result.success) {
      synced += 1
    } else {
      failed += 1
    }
    details.push(result)
  }

  return { total: unique.length, synced, skipped, failed, details }
}

/** User ids that have a litellm index row locally, for the backfill job. */
export async function listUsersWithGatewayKeys(limit = 500): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: apiKeys.userId })
    .from(apiKeys)
    .where(eq(apiKeys.provider, 'litellm'))
    .limit(limit)

  return rows.map((row) => row.userId)
}

/** Re-exported so callers can reach the allocation helpers through one module. */
export { computeKeyBudget, computeSharedPoolBudgets, roundTo, SHARED_POOL_BASE } from '@workspace/litellm'
