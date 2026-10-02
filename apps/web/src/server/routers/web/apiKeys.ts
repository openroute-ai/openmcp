import { createHash, randomBytes } from 'node:crypto'
import { and, count, desc, eq, ilike } from 'drizzle-orm'
import { getVirtualKeyManager, isLiteLLMConfigured } from '@workspace/litellm'
import { z } from 'zod'
import {
  getNewKeyBudgetParams,
  readAvailableBalance,
  readBudgetMeta,
  syncUserGatewayBudget,
} from '@/lib/budget/budget-sync'
import { db } from '@/lib/db'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'
import { apiKeys } from '@workspace/db'

const createApiKeySchema = z.object({
  name: z.string().min(1).max(256),
  prefix: z.string().max(64).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

const deleteApiKeySchema = z.object({
  id: z.string().min(1),
})

const DEFAULT_KEY_PREFIX = 'omk'

/**
 * Offline issuance (non-production only): when LiteLLM is not configured we can
 * still create a key, but it cannot reach the platform gateway, and the panel
 * exposes that through provider='local'.
 */
function generateLocalApiKey(prefix?: string): { rawKey: string; start: string; hashedKey: string } {
  const rawKey = `${prefix?.trim() || DEFAULT_KEY_PREFIX}_${randomBytes(24).toString('hex')}`
  return {
    rawKey,
    start: rawKey.slice(0, 12),
    hashedKey: createHash('sha256').update(rawKey).digest('hex'),
  }
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** A LiteLLM key_alias must be globally unique and traceable to its source. */
function buildKeyAlias(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `openmcp-${slug || 'key'}-${randomBytes(4).toString('hex')}`
}

/** LiteLLM durations look like '30d' / '12h' / '60m' / '7d'. */
function toLiteLLMDuration(days: number): string {
  return `${Math.max(1, Math.floor(days))}d`
}

export const apiKeysRouter = createTRPCRouter({
  /**
   * The current user's API key list.
   */
  listApiKeys: protectedProcedure
    .input(
      z
        .object({
          search: z.string().max(200).optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(20),
        })
        // 调用方不传参数时也要能用：整个 input 可选，缺省走第一页。
        .optional()
    )
    .query(async ({ ctx, input }) => {
    try {
      const page = input?.page ?? 1
      const pageSize = input?.pageSize ?? 20
      const where = input?.search
        ? and(eq(apiKeys.userId, ctx.user.id), ilike(apiKeys.name, `%${input.search}%`))
        : eq(apiKeys.userId, ctx.user.id)

      const [rows, [totalRow]] = await Promise.all([
        db
          .select()
          .from(apiKeys)
          .where(where)
          .orderBy(desc(apiKeys.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: count() }).from(apiKeys).where(where),
      ])

      return {
        success: true,
        total: totalRow?.n ?? 0,
        page,
        pageSize,
        data: rows.map((row) => ({
          id: row.id,
          name: row.name,
          start: row.start,
          prefix: row.prefix,
          provider: row.provider,
          keyAlias: row.keyAlias,
          enabled: row.enabled,
          remaining: row.remaining,
          requestCount: row.requestCount,
          rateLimitMax: row.rateLimitMax,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          lastRequest: row.lastRequest,
          budget: readBudgetMeta(row.metadata),
        })),
      }
    } catch (error) {
      console.error('Failed to list API keys:', error)
      return { success: false, error: 'Failed to list API keys' }
    }
  }),

  /**
   * Gateway allowance status: balance plus a budget mirror per key and whether
   * they are blocked.
   *
   * Marketplace MCP / A2A requests go straight to LiteLLM, so openmcp cannot
   * intercept the call path. "Out of balance" therefore has to be visible
   * before the request is sent — this query and the panel warning are that
   * early notice. The real hard block is enforced by LiteLLM's `max_budget` /
   * `blocked`.
   */
  getGatewayBudgetStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const available = await readAvailableBalance(ctx.user.id)
      const rows = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          provider: apiKeys.provider,
          keyAlias: apiKeys.keyAlias,
          metadata: apiKeys.metadata,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.user.id))

      const keys = rows.map((row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        keyAlias: row.keyAlias,
        budget: readBudgetMeta(row.metadata),
      }))

      const gatewayKeys = keys.filter((key) => key.provider === 'litellm')
      const availableNumber = Number(available)

      return {
        success: true,
        data: {
          available,
          currency: 'CNY',
          /** Blocked on the gateway side: balance exhausted, or a budget was never pushed. */
          blocked: availableNumber <= 0 || gatewayKeys.length === 0,
          gatewayKeyCount: gatewayKeys.length,
          keys,
          gatewayConfigured: isLiteLLMConfigured(),
        },
      }
    } catch (error) {
      console.error('Failed to get gateway budget status:', error)
      return { success: false as const, error: 'Failed to get gateway budget status' }
    }
  }),

  /**
   * Manually push the current balance to every gateway key.
   *
   * The fallback entry point for when a recharge failed to sync, or when the
   * user removed the gateway config by mistake. Idempotent.
   */
  syncGatewayBudget: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await syncUserGatewayBudget(ctx.user.id)
      const success = result.skipped ? true : result.success
      return {
        success: success as boolean,
        data: {
          skipped: result.skipped,
          skipReason: result.skipReason ?? null,
          available: result.available,
          updated: result.updated,
          failed: result.failed,
          keys: result.keys.map((item) => ({
            keyAlias: item.keyAlias,
            keySpend: item.keySpend,
            targetMaxBudget: item.targetMaxBudget,
            targetBlocked: item.targetBlocked,
            previousMaxBudget: item.previousMaxBudget,
            changed: item.changed,
            success: item.success,
            error: item.error ?? null,
          })),
        },
      }
    } catch (error) {
      console.error('Failed to sync gateway budget:', error)
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Failed to sync gateway budget',
      }
    }
  }),

  /**
   * Create an API key (proxies LiteLLM to issue a virtual key, storing only a
   * SHA-256 index locally).
   */
  createApiKey: protectedProcedure.input(createApiKeySchema).mutation(async ({ ctx, input }) => {
    const now = new Date()
    const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86400000) : null

    try {
      if (isLiteLLMConfigured()) {
        const keyAlias = buildKeyAlias(input.name)
        // A new key ships with a budget ceiling: an exhausted balance is
        // blocked outright, which avoids a window where we judge a balance but
        // the gateway has no limit.
        const budget = await getNewKeyBudgetParams(ctx.user.id)
        const generated = await getVirtualKeyManager().generateKey({
          key_alias: keyAlias,
          user_id: ctx.user.id,
          metadata: { openmcp_key_name: input.name },
          max_budget: budget.max_budget,
          blocked: budget.blocked,
          ...(input.expiresInDays ? { duration: toLiteLLMDuration(input.expiresInDays) } : {}),
        })

        const rawKey = generated.key
        if (!rawKey) {
          console.error('[apiKeys] Gateway returned no key, revoking alias:', keyAlias)
          await getVirtualKeyManager()
            .deleteKeys({ key_aliases: [keyAlias] })
            .catch((revokeError) => {
              console.error('[apiKeys] Failed to revoke gateway key without token:', keyAlias, revokeError)
            })
          return { success: false, error: 'The gateway returned no key, please try again' }
        }

        let row: typeof apiKeys.$inferSelect | undefined
        try {
          const inserted = await db
            .insert(apiKeys)
            .values({
              name: input.name,
              start: rawKey.slice(0, 12),
              prefix: input.prefix || null,
              key: hashKey(rawKey),
              provider: 'litellm',
              keyAlias,
              litellmKeyName: generated.key_name || keyAlias,
              userId: ctx.user.id,
              enabled: true,
              rateLimitEnabled: false,
              rateLimitTimeWindow: 3600000,
              rateLimitMax: 0,
              requestCount: 0,
              remaining: null,
              expiresAt,
              createdAt: now,
              updatedAt: now,
              metadata: {
                openmcp_key_name: input.name,
                gatewayBudget: {
                  maxBudget: budget.max_budget,
                  keySpend: 0,
                  blocked: budget.blocked,
                  available: String(budget.max_budget),
                  syncedAt: now.toISOString(),
                },
              },
            })
            .returning()
          row = inserted[0]
        } catch (error) {
          // The gateway issued a key but the local index write failed: an
          // orphaned credential. Revoke it now rather than leaving a secret
          // live on the gateway where openmcp can no longer see it.
          console.error('[apiKeys] Local index insert failed, revoking gateway key:', keyAlias, error)
          await getVirtualKeyManager()
            .deleteKeys({ key_aliases: [keyAlias] })
            .catch((revokeError) => {
              console.error('[apiKeys] Failed to revoke orphaned gateway key:', keyAlias, revokeError)
            })
          throw error
        }

        if (!row) {
          return { success: false, error: 'Failed to persist the API key' }
        }

        return {
          success: true,
          data: {
            id: row.id,
            apiKey: rawKey, // returned exactly once
            name: row.name,
            provider: row.provider,
            expiresAt: row.expiresAt,
          },
        }
      }

      if (process.env.NODE_ENV === 'production') {
        console.error('[apiKeys] LiteLLM is not configured; refusing to issue a key that cannot reach the gateway')
        return { success: false, error: 'The API Key service is not configured, please contact an administrator' }
      }

      const { rawKey, start, hashedKey } = generateLocalApiKey(input.prefix)
      const [localRow] = await db
        .insert(apiKeys)
        .values({
          name: input.name,
          start,
          prefix: input.prefix || null,
          key: hashedKey,
          provider: 'local',
          userId: ctx.user.id,
          enabled: true,
          rateLimitEnabled: false,
          rateLimitTimeWindow: 3600000,
          rateLimitMax: 0,
          requestCount: 0,
          remaining: null,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (!localRow) {
        return { success: false, error: 'Failed to persist the API key' }
      }

      return {
        success: true,
        data: {
          id: localRow.id,
          apiKey: rawKey,
          name: localRow.name,
          provider: localRow.provider,
          expiresAt: localRow.expiresAt,
        },
      }
    } catch (error) {
      console.error('Failed to create API key:', error)
      return { success: false, error: 'Failed to create API key' }
    }
  }),

  /**
   * Delete an API key (own keys only).
   *
   * The gateway key is revoked before the local row is removed: once a key is
   * pasted into an agent it is a long-lived credential, so deleting only the
   * local row would leave a still-usable credential behind.
   */
  deleteApiKey: protectedProcedure.input(deleteApiKeySchema).mutation(async ({ ctx, input }) => {
    try {
      const [row] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)))
        .limit(1)

      if (!row) {
        return { success: false, error: 'Key does not exist' }
      }

      if (row.provider === 'litellm' && row.keyAlias) {
        if (!isLiteLLMConfigured()) {
          return { success: false, error: 'The gateway is not configured and cannot revoke the key; contact an administrator' }
        }
        try {
          await getVirtualKeyManager().deleteKeys({ key_aliases: [row.keyAlias] })
        } catch (error) {
          console.error('[apiKeys] Failed to revoke key on gateway:', error)
          return { success: false, error: 'Gateway revocation failed, please try again' }
        }
      }

      await db.delete(apiKeys).where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)))

      return { success: true }
    } catch (error) {
      console.error('Failed to delete API key:', error)
      return { success: false, error: 'Failed to delete API key' }
    }
  }),
})
