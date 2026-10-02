/**
 * Provider「调用观测」的真实数据来源。
 *
 * 之前这个面板的数据是前端用 `hash(id + status)` 算出来的确定性假值
 * （`assets-data.ts` 的 `buildMetrics` / `buildCallLogs`）。假数据在这里特别
 * 危险：Provider 会照着它判断自己资产跑得好不好，而"请求数""成功率""错误数"
 * 看起来完全是真实监控的样子。因此这里只读真实账本，一个数都不造。
 *
 * 两处"看起来像数据但我们没有"的字段，刻意显示为未采集而不是填 0：
 *
 * - **错误数 / 成功率**：`gateway_spend_records` 只记录**成功计费**的调用
 *   （入账前提是 `spend > 0`）。失败的调用根本没落库，所以这里既算不出错误率
 *   也算不出成功率——显示 0% 会让一个挂掉的资产看起来完美健康。
 * - **部分延迟**：`latency_ms` 只在 LiteLLM 同时给出 startTime 和 endTime 时
 *   才写入。`latencyCoverage` 把这个比例显式暴露出来，避免"部分调用有延迟"
 *   被误读成"延迟分布完整"。
 *
 * 调用明细因此叫"计费调用"而不是"调用日志"：它逐条对应一次真实扣费，
 * 不包含未计费的失败尝试。
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { gatewaySpendRecords } from '@workspace/db'
import { db } from '@/lib/db'

export type GatewayAssetType = 'mcp' | 'a2a'

export interface AssetUsageSummary {
  /** 已计费调用次数 */
  calls: number
  /** 累计扣款（CNY，字符串避免浮点误差外泄） */
  spend: string
  tokens: number
  /** 中位延迟（毫秒）。无延迟样本时为 null */
  p50Ms: number | null
  /** P95 延迟（毫秒）。无延迟样本时为 null */
  p95Ms: number | null
  /** 有延迟样本的调用占比 0~1 */
  latencyCoverage: number
}

export interface BilledCall {
  id: string
  requestId: string
  occurredAt: Date
  caller: string | null
  /** LiteLLM call_type；缺失时为 null */
  callType: string | null
  latencyMs: number | null
  cost: string
  tokens: number
}

const EMPTY: AssetUsageSummary = {
  calls: 0,
  spend: '0',
  tokens: 0,
  p50Ms: null,
  p95Ms: null,
  latencyCoverage: 0,
}

function toSummary(row: {
  calls: number
  spend: string
  tokens: number
  p50Ms: number | null
  p95Ms: number | null
  latencyCovered: number
} | null): AssetUsageSummary {
  if (!row || row.calls === 0) return EMPTY
  return {
    calls: row.calls,
    spend: row.spend,
    tokens: row.tokens,
    p50Ms: row.p50Ms === null ? null : Math.round(row.p50Ms),
    p95Ms: row.p95Ms === null ? null : Math.round(row.p95Ms),
    latencyCoverage: row.latencyCovered / row.calls,
  }
}

function windowStart(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

/** 聚合查询的 SELECT 片段；`percentile_cont` 在有样本时返回数值，否则 null。 */
const AGGREGATE_COLUMNS = {
  calls: sql<number>`count(*)::int`,
  spend: sql<string>`coalesce(sum(${gatewaySpendRecords.spend}), 0)`,
  tokens: sql<number>`coalesce(sum(${gatewaySpendRecords.totalTokens}), 0)::int`,
  p50Ms: sql<number | null>`percentile_cont(0.5) within group (order by ${gatewaySpendRecords.latencyMs})`,
  p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${gatewaySpendRecords.latencyMs})`,
  latencyCovered: sql<number>`count(${gatewaySpendRecords.latencyMs})::int`,
}

/** 单个资产的真实用量聚合。 */
export async function getAssetUsageSummary(
  assetType: GatewayAssetType,
  assetId: string,
  days = 30
): Promise<AssetUsageSummary> {
  const [row] = await db
    .select(AGGREGATE_COLUMNS)
    .from(gatewaySpendRecords)
    .where(
      and(
        eq(gatewaySpendRecords.assetType, assetType),
        eq(gatewaySpendRecords.assetId, assetId),
        gte(gatewaySpendRecords.occurredAt, windowStart(days))
      )
    )
  return toSummary(row ?? null)
}

export type AssetUsageKey = `${GatewayAssetType}:${string}`

/**
 * 一次取回某位 Provider 名下全部资产的聚合，避免列表页 N+1 查询。
 *
 * 返回的 Map 只包含**有计费记录**的资产；没有记录的资产调用方应自行按
 * `EMPTY` 处理，不要当成"0 次调用且一切正常"。
 */
export async function getAuthorUsageSummaries(
  authorId: string,
  days = 30
): Promise<Map<AssetUsageKey, AssetUsageSummary>> {
  const rows = await db
    .select({
      assetType: gatewaySpendRecords.assetType,
      assetId: gatewaySpendRecords.assetId,
      ...AGGREGATE_COLUMNS,
    })
    .from(gatewaySpendRecords)
    .where(
      and(
        eq(gatewaySpendRecords.authorId, authorId),
        gte(gatewaySpendRecords.occurredAt, windowStart(days))
      )
    )

  const out = new Map<AssetUsageKey, AssetUsageSummary>()
  for (const row of rows) {
    // 未归属到具体资产的消费（assetId 为空）不参与资产维度展示
    if (!row.assetType || !row.assetId) continue
    out.set(`${row.assetType}:${row.assetId}` as AssetUsageKey, toSummary(row))
  }
  return out
}

/** 某资产最近若干条真实计费调用，按时间倒序。 */
export async function listBilledCalls(
  assetType: GatewayAssetType,
  assetId: string,
  limit = 14,
  days = 30
): Promise<BilledCall[]> {
  return db
    .select({
      id: gatewaySpendRecords.id,
      requestId: gatewaySpendRecords.requestId,
      occurredAt: gatewaySpendRecords.occurredAt,
      caller: gatewaySpendRecords.keyAlias,
      callType: gatewaySpendRecords.callType,
      latencyMs: gatewaySpendRecords.latencyMs,
      cost: gatewaySpendRecords.spend,
      tokens: gatewaySpendRecords.totalTokens,
    })
    .from(gatewaySpendRecords)
    .where(
      and(
        eq(gatewaySpendRecords.assetType, assetType),
        eq(gatewaySpendRecords.assetId, assetId),
        gte(gatewaySpendRecords.occurredAt, windowStart(days))
      )
    )
    .orderBy(desc(gatewaySpendRecords.occurredAt))
    .limit(limit)
}

/** 列表页顶部的总量汇总（真实求和，不做跨资产平均）。 */
export function summarizeAcross(summaries: AssetUsageSummary[]): AssetUsageSummary {
  if (summaries.length === 0) return EMPTY
  let calls = 0
  let tokens = 0
  let spend = 0
  let weightedP50 = 0
  let weightedP95 = 0
  let covered = 0
  for (const s of summaries) {
    calls += s.calls
    tokens += s.tokens
    spend += Number(s.spend)
    if (s.p50Ms !== null && s.p95Ms !== null) {
      weightedP50 += s.p50Ms * s.calls
      weightedP95 += s.p95Ms * s.calls
      covered += s.latencyCoverage * s.calls
    }
  }
  return {
    calls,
    spend: spend.toFixed(6),
    tokens,
    p50Ms: covered > 0 ? Math.round(weightedP50 / covered) : null,
    p95Ms: covered > 0 ? Math.round(weightedP95 / covered) : null,
    latencyCoverage: calls > 0 ? covered / calls : 0,
  }
}