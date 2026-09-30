/**
 * 网关消费结算：LiteLLM spend logs → OpenMCP 余额扣款 + Provider 分成
 *
 * 设计见 docs/LITELLM_BUDGET_SYNC.md §6（阶段二 S1 / S4）。
 *
 * 这一层是整个资金闭环的收口。v1.0 只做了「余额 → max_budget」单向同步，
 * 而 MCP/A2A 消费**从不回写 balances**，导致：
 *   - 面板余额长期偏高（充值减、消费不减）
 *   - amountSpend 不含网关支出
 *   - max_budget 守着一个不断漂移的锚点
 *
 * 货币语义：与 `budget-sync.ts` 一致，OpenMCP 与 LiteLLM 之间不做任何货币换算，
 * `balances.amountTotal`（CNY）的裸数值直接与 LiteLLM 的 `spend` 相减。
 */

import { createHash } from 'node:crypto'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  a2aAgents,
  apiKeys,
  balances,
  gatewaySpendRecords,
  mcpServers,
  PROVIDER_REVENUE_SHARE,
  providerDailyUsage,
  providerEarnings,
} from '@workspace/db'
import { isLiteLLMConfigured } from '@workspace/litellm'
import { syncUserGatewayBudget } from '@/lib/budget/budget-sync'
import { LiteLLMSpendingManager, type SpendLog } from '@workspace/litellm'

/** 与网关消费账本一行的最大处理条数，避免单个事务过大锁表 */
const BATCH_SIZE = 200

interface AssetMatch {
  authorId: string
  assetType: 'mcp' | 'a2a'
}

export interface SettlementResult {
  success: boolean
  skipped: boolean
  error?: string
  /** 拉到的 LiteLLM 原始日志数 */
  totalLogs: number
  /** 归属到本地 Key + 市场资产、可入账的条数 */
  matched: number
  /** 本次新插入账本的条数（其余为已存在的 request_id） */
  inserted: number
  /** 唯一约束挡下的重复条数 */
  duplicates: number
  /** 查不到本地 Key 的条数（已删 Key / 非本平台 Key） */
  orphaned: number
  /** 累计扣款金额 */
  debitedAmount: string
  /** 余额耗尽后的溢出额合计 */
  overspendAmount: string
  /** 触发了预算回推的用户 */
  resyncedUsers: string[]
  /** 生成了 Provider 分成的条数 */
  earningsCreated: number
}

function emptyResult(overrides: Partial<SettlementResult> = {}): SettlementResult {
  return {
    success: true,
    skipped: true,
    totalLogs: 0,
    matched: 0,
    inserted: 0,
    duplicates: 0,
    orphaned: 0,
    debitedAmount: '0',
    overspendAmount: '0',
    resyncedUsers: [],
    earningsCreated: 0,
    ...overrides,
  }
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

/** 本地存的是 sha256(apiKey)，LiteLLM 日志返回明文 api_key —— 据此反查归属 */
function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * 构建 LiteLLM model 名 → 市场资产的映射。
 *
 * `mcp_servers.serverName` / `a2a_agents.agentName` 即网关侧的唯一标识，
 * 也是消费归属的判定依据：只有命中市场资产的消费才参与结算，
 * 平台自用（Store MCP 等直接挂载的服务）不扣用户钱。
 */
async function buildAssetMap(): Promise<Map<string, AssetMatch>> {
  const map = new Map<string, AssetMatch>()
  const [mcps, a2as] = await Promise.all([
    db
      .select({ authorId: mcpServers.authorId, serverName: mcpServers.serverName })
      .from(mcpServers)
      .where(sql`${mcpServers.serverName} is not null and ${mcpServers.serverName} <> ''`),
    db
      .select({ authorId: a2aAgents.authorId, agentName: a2aAgents.agentName })
      .from(a2aAgents)
      .where(sql`${a2aAgents.agentName} is not null and ${a2aAgents.agentName} <> ''`),
  ])

  for (const row of mcps) {
    const key = normalizeKey(row.serverName)
    if (key) map.set(key, { authorId: row.authorId, assetType: 'mcp' })
  }
  for (const row of a2as) {
    const key = normalizeKey(row.agentName)
    if (key) map.set(key, { authorId: row.authorId, assetType: 'a2a' })
  }
  return map
}

interface ResolvedLog {
  requestId: string
  userId: string
  apiKeyId: string | null
  keyAlias: string | null
  spend: number
  totalTokens: number
  assetType: 'mcp' | 'a2a' | null
  assetName: string | null
  authorId: string | null
  model: string | null
  occurredAt: Date
}

/**
 * 把 LiteLLM 日志解析为可入账的账本行。
 *
 * 归属解析链：明文 api_key → sha256 → api_keys.key → user_id / key_alias。
 * 任何一环缺失就丢弃该条（记为 orphaned），**不阻塞整批**——
 * 一次回补里混几条无法归属的日志是正常的（Key 已删、日志被裁剪）。
 */
async function resolveLogs(
  logs: SpendLog[],
  assetMap: Map<string, AssetMatch>,
  window: { start: Date; end: Date }
): Promise<{ resolved: ResolvedLog[]; orphaned: number }> {
  const candidates = logs
    .map((raw) => {
      if (typeof raw !== 'object' || raw === null) return null
      const log = raw as Partial<SpendLog>
      const requestId = log.request_id || null
      const rawKey = log.api_key || null
      if (!requestId || !rawKey) return null

      const spend = Number(log.spend || 0)
      if (!Number.isFinite(spend) || spend <= 0) return null

      const occurredAt = new Date(typeof log.startTime === 'string' ? log.startTime : '')
      if (Number.isNaN(occurredAt.getTime())) return null
      if (occurredAt < window.start || occurredAt >= window.end) return null

      const model = typeof log.model === 'string' ? log.model : null
      const match = model ? assetMap.get(normalizeKey(model)) : undefined

      return {
        requestId,
        apiKeyHash: hashApiKey(rawKey),
        spend,
        totalTokens: Number(log.total_tokens || 0) || 0,
        assetType: match?.assetType ?? null,
        assetName: model,
        authorId: match?.authorId ?? null,
        model,
        occurredAt,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  if (candidates.length === 0) return { resolved: [], orphaned: 0 }

  // 一次性把涉及的 hash 查出来，避免逐条查询
  const hashes = Array.from(new Set(candidates.map((c) => c.apiKeyHash)))
  const keyRows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      keyAlias: apiKeys.keyAlias,
      key: apiKeys.key,
    })
    .from(apiKeys)
    .where(sql`${apiKeys.key} in ${hashes}`)

  const byHash = new Map<string, (typeof keyRows)[number]>()
  for (const row of keyRows) byHash.set(row.key, row)

  const resolved: ResolvedLog[] = []
  let orphaned = 0
  for (const candidate of candidates) {
    const keyRow = byHash.get(candidate.apiKeyHash)
    if (!keyRow) {
      orphaned += 1
      continue
    }
    resolved.push({
      requestId: candidate.requestId,
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      keyAlias: keyRow.keyAlias,
      spend: candidate.spend,
      totalTokens: candidate.totalTokens,
      assetType: candidate.assetType,
      assetName: candidate.assetName,
      authorId: candidate.authorId,
      model: candidate.model,
      occurredAt: candidate.occurredAt,
    })
  }

  return { resolved, orphaned }
}

/**
 * 扣款 + 落账本（单事务）。
 *
 * 顺序是刻意的：**先插 `gateway_spend_records`**，唯一约束会挡住重复的
 * `request_id`；只有插入成功的行才继续扣款。反过来先扣款的话，
 * 并发同步会在扣款之后才发现重复，白扣一次。
 *
 * 余额不足时扣到 0 为止，溢出部分记入 `overspend_amount`：
 * LiteLLM 的 `max_budget` 是滞后的（本次消费发生时余额可能已接近 0），
 * 扣出负余额会让「充值加回来」这条恢复路径难以推理。
 */
async function debitAndRecord(entries: ResolvedLog[]): Promise<{
  inserted: number
  duplicates: number
  debited: number
  overspend: number
  touchedUsers: Set<string>
  newRecords: { id: string; authorId: string | null; userId: string; spend: number }[]
}> {
  const inserted: string[] = []
  let duplicates = 0
  let debited = 0
  let overspend = 0
  const touchedUsers = new Set<string>()
  const newRecords: { id: string; authorId: string | null; userId: string; spend: number }[] = []

  for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
    const batch = entries.slice(offset, offset + BATCH_SIZE)

    await db.transaction(async (tx) => {
      for (const entry of batch) {
        // 逐条插入并检查返回：onConflictDoNothing 只能告诉 us「有没有冲突」，
        // 而我们必须知道是哪一条，才能决定是否扣它的款
        const insertedRows = await tx
          .insert(gatewaySpendRecords)
          .values({
            requestId: entry.requestId,
            userId: entry.userId,
            apiKeyId: entry.apiKeyId,
            keyAlias: entry.keyAlias,
            spend: entry.spend.toFixed(8),
            totalTokens: entry.totalTokens,
            assetType: entry.assetType,
            assetName: entry.assetName,
            authorId: entry.authorId,
            model: entry.model,
            occurredAt: entry.occurredAt,
          })
          .onConflictDoNothing({ target: gatewaySpendRecords.requestId })
          .returning({ id: gatewaySpendRecords.id })

        const record = insertedRows[0]
        if (!record) {
          duplicates += 1
          continue
        }
        inserted.push(entry.requestId)
        newRecords.push({ id: record.id, authorId: entry.authorId, userId: entry.userId, spend: entry.spend })

        // 扣款：先算这个用户扣完之后还剩多少，再决定实际扣多少
        const [balanceRow] = await tx
          .select({ amountTotal: balances.amountTotal })
          .from(balances)
          .where(eq(balances.userId, entry.userId))
          .limit(1)

        const available = balanceRow ? Number(balanceRow.amountTotal) : 0
        const current = Number.isFinite(available) && available > 0 ? available : 0
        const applied = Math.min(current, entry.spend)
        const over = roundTo(entry.spend - applied)

        if (balanceRow && (applied > 0 || over > 0)) {
          // ::numeric 显式转型：postgres.js 把 JS 字符串发成 text，
          // 少了它会得到 "operator does not exist: numeric - text"
          await tx
            .update(balances)
            .set({
              amount: sql`greatest(0, ${balances.amount} - ${applied.toFixed(8)}::numeric)`,
              amountTotal: sql`greatest(0, ${balances.amountTotal} - ${applied.toFixed(8)}::numeric)`,
              amountSpend: sql`${balances.amountSpend} + ${entry.spend.toFixed(8)}::numeric`,
              updatedAt: new Date(),
            })
            .where(eq(balances.userId, entry.userId))
        }

        // 溢出额记在账本行上（而非汇总字段），这样对账时能逐条追查
        if (over > 0) {
          await tx
            .update(gatewaySpendRecords)
            .set({ overspendAmount: over.toFixed(8) })
            .where(eq(gatewaySpendRecords.id, record.id))
        }

        debited += applied
        overspend += over
        touchedUsers.add(entry.userId)
      }
    })
  }

  return {
    inserted: inserted.length,
    duplicates,
    debited: roundTo(debited),
    overspend: roundTo(overspend),
    touchedUsers,
    newRecords,
  }
}

/**
 * S4：按 `PROVIDER_REVENUE_SHARE` 给 Provider 记分成。
 *
 * `gateway_record_id` 唯一，一次消费只分成一次；
 * 同一批账本重复结算是安全的（`onConflictDoNothing`）。
 *
 * 金额口径与账本一致：CNY 裸数值，不换算。
 * `provider_earnings` 金额字段是 `decimal(10,2)`，两位小数，
 * 极小额的调用分成会被舍入为 0 —— 这是 schema 精度限制，不是本函数的问题。
 */
async function creditGatewayEarnings(
  records: { id: string; authorId: string | null; userId: string; spend: number }[]
) {
  let created = 0
  for (const record of records) {
    if (!record.authorId) continue
    const gross = roundTo(record.spend)
    const net = roundTo(gross * PROVIDER_REVENUE_SHARE)
    const fee = roundTo(gross - net)
    if (gross <= 0) continue

    const rows = await db
      .insert(providerEarnings)
      .values({
        authorId: record.authorId,
        buyerUserId: record.userId,
        gatewayRecordId: record.id,
        grossAmount: gross.toFixed(2),
        platformFee: fee.toFixed(2),
        netAmount: net.toFixed(2),
        currency: 'CNY',
        status: 'payable',
      })
      .onConflictDoNothing({ target: providerEarnings.gatewayRecordId })
      .returning({ id: providerEarnings.id })

    created += rows.length
  }
  return created
}

function roundTo(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * 按 `gateway_spend_records` 重算并**覆盖** `provider_daily_usage`。
 *
 * v1.0 是 `spend = spend + excluded.spend` 的累加器，回补 `?days=30`
 * 会把同一批日志重复累加，报表随回补次数膨胀。改为按区间重算覆盖后，
 * 报表始终等于账本在窗口内的聚合值。
 */
async function rebuildDailyUsage(window: { start: Date; end: Date }): Promise<number> {
  const rows = await db
    .select({
      authorId: gatewaySpendRecords.authorId,
      day: sql<string>`to_char(${gatewaySpendRecords.occurredAt}, 'YYYY-MM-DD')`,
      assetType: gatewaySpendRecords.assetType,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${gatewaySpendRecords.totalTokens}), 0)::int`,
      spend: sql<string>`coalesce(sum(${gatewaySpendRecords.spend}), 0)`,
    })
    .from(gatewaySpendRecords)
    .where(
      and(
        gte(gatewaySpendRecords.occurredAt, window.start),
        lt(gatewaySpendRecords.occurredAt, window.end),
        sql`${gatewaySpendRecords.authorId} is not null`,
        sql`${gatewaySpendRecords.assetType} is not null`
      )
    )
    .groupBy(
      gatewaySpendRecords.authorId,
      sql`to_char(${gatewaySpendRecords.occurredAt}, 'YYYY-MM-DD')`,
      gatewaySpendRecords.assetType
    )

  for (const row of rows) {
    const assetType = row.assetType as 'mcp' | 'a2a'
    await db
      .insert(providerDailyUsage)
      .values({
        authorId: row.authorId as string,
        date: new Date(`${row.day}T00:00:00.000Z`),
        assetType,
        calls: row.calls,
        tokens: row.tokens,
        spend: row.spend,
      })
      .onConflictDoUpdate({
        target: [providerDailyUsage.authorId, providerDailyUsage.date, providerDailyUsage.assetType],
        set: {
          calls: row.calls,
          tokens: row.tokens,
          spend: row.spend,
          updatedAt: new Date(),
        },
      })
  }

  return rows.length
}

/**
 * 结算网关消费（幂等，可重复执行）。
 *
 * 依赖顺序：S1 扣款落账本 → S2 回推 max_budget → S4 Provider 分成。
 * 预算回推放在扣款之后：LiteLLM 先记 spend、我们后扣款，
 * 两者在时间上错开；先推预算等于把还没扣的余额又发出去一次。
 *
 * @param days 回看天数（含今天）。默认 1 表示昨天 + 今天。
 */
export async function settleGatewaySpend(days = 1): Promise<SettlementResult> {
  if (!isLiteLLMConfigured()) {
    return emptyResult()
  }

  try {
    const end = new Date()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - days)
    const window = { start, end }

    const assetMap = await buildAssetMap()
    const manager = new LiteLLMSpendingManager()
    const logs = await manager.getSpendLogs({
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      summarize: false,
    })

    const { resolved, orphaned } = await resolveLogs(logs, assetMap, window)
    if (resolved.length === 0) {
      return emptyResult({ skipped: false, totalLogs: logs.length, orphaned })
    }

    const { inserted, duplicates, debited, overspend, touchedUsers, newRecords } = await debitAndRecord(resolved)

    // S2：扣款后立即回推。失败不回滚账本——余额已经扣了，
    // 预算会由下一次同步或回补任务补上，账本才是真相。
    const resyncedUsers: string[] = []
    for (const userId of touchedUsers) {
      try {
        const result = await syncUserGatewayBudget(userId)
        if (!result.skipped) resyncedUsers.push(userId)
      } catch (error) {
        console.error('[settlement] Failed to resync budget after debit:', userId, error)
      }
    }

    const earningsCreated = await creditGatewayEarnings(newRecords)
    await rebuildDailyUsage(window)

    return {
      success: true,
      skipped: false,
      totalLogs: logs.length,
      matched: resolved.length,
      inserted,
      duplicates,
      orphaned,
      debitedAmount: String(debited),
      overspendAmount: String(overspend),
      resyncedUsers,
      earningsCreated,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[settlement] Failed to settle gateway spend:', error)
    return emptyResult({
      success: false,
      skipped: false,
      error: message,
    })
  }
}
