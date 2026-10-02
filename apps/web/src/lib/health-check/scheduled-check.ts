/**
 * 定时健康检查。
 *
 * 表里本来就有 `healthCheckEnabled` / `lastTestedAt` / `lastTestResult` /
 * `connectionStatus`，但直到这里之前只有提供方手动点「重新测试」才会更新。
 * 问题是 `connectionStatus` 同时决定**市场可见性**（`assets/visibility.ts`）和
 * **安装门禁**（`mcp-servers/entitlement.ts`），所以资产一旦真的挂掉，买家看到的
 * 和能装到的都会立刻变化——这个状态不该只在有人手动去点的时候才更新。
 *
 * 两条不能省的约束：
 *
 * 1. **只探测 `healthCheckEnabled = true` 的资产。** 这是一个 opt-in 字段：
 *    持续轮询别人的端点会产生对方没预期的流量，而提供方明确表达过不想被探测时，
 *    表里就没有开关可用了。开关关着的资产即使挂掉也保持原状——那是提供方自己的
 *    资产，状态由他自己决定什么时候更新。
 *
 * 2. **单次失败不改变 `connectionStatus`。** 连续失败达到阈值才置 `error`
 *    （默认 3），成功一次即清零并恢复 `online`。见 `healthFailCount` 的注释：
 *    一次超时就把正常资产踢出市场，创作者的收入会在没人观察到故障时就断掉。
 *
 * 并发是**按资产**受限而不是全局串行：单个端点超时（探测有超时上限）不该拖住
 * 整轮检查，而一轮几百个资产全并发会把平台自己和被探测方一起打挂。
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { a2aAgents, mcpServers } from '@workspace/db'
import { db } from '@/lib/db'
import { a2aGatewayAccess } from '@/web/a2a-agents/gateway'
import { mcpGatewayAccess } from '@/web/mcp-servers/gateway'

/** 连续失败多少次才把资产置为 `error`。可用环境变量覆盖。 */
function envFailureThreshold(fallback: number): number {
  const raw = Number.parseInt(process.env.HEALTH_CHECK_FAIL_THRESHOLD ?? '', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : fallback
}

/** 一轮里同时探测多少个资产。 */
function envConcurrency(fallback: number): number {
  const raw = Number.parseInt(process.env.HEALTH_CHECK_CONCURRENCY ?? '', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : fallback
}

/**
 * 一次原子更新同时写 `connectionStatus` 和 `healthFailCount`。
 *
 * 原来是"读出 failCount → 在 JS 里 +1 → 写回"。cron 重叠时两个 worker 会读到
 * 同一个旧值、各自 +1 后写回同一个数，计数卡在 1，资产永远差一轮才下架。
 *
 * 现在是一条 UPDATE：PostgreSQL 里 UPDATE 的所有表达式读的都是**旧行**值，
 * 所以 `health_fail_count + 1 >= threshold` 与写入的新计数天然一致，不需要
 * 回读也不需要事务。
 */
function healthPatch(
  healthy: boolean,
  result: unknown,
  threshold: number,
  cols: { connectionStatus: AnyPgColumn; healthFailCount: AnyPgColumn }
) {
  const nextFailCount = healthy ? 0 : sql`${cols.healthFailCount} + 1`
  const nextStatus = healthy
    ? sql`'online'`
    : sql`CASE WHEN ${cols.healthFailCount} + 1 >= ${threshold} THEN 'error' ELSE ${cols.connectionStatus} END`

  return {
    connectionStatus: nextStatus,
    healthFailCount: nextFailCount,
    lastTestedAt: new Date(),
    lastTestResult: result,
    updatedAt: new Date(),
  }
}

export interface HealthCheckSummary {
  kind: 'mcp' | 'a2a'
  checked: number
  healthy: number
  /** 本轮失败但未达阈值，资产仍保持 `online`。 */
  degraded: number
  /** 本轮达到阈值，已置为 `error`（从市场下架、禁止新安装）。 */
  takenOffline: number
  /** 本轮恢复 `online`。 */
  recovered: number
  errors: string[]
}

const EMPTY: Omit<HealthCheckSummary, 'kind'> = {
  checked: 0,
  healthy: 0,
  degraded: 0,
  takenOffline: 0,
  recovered: 0,
  errors: [],
}

/**
 * 串行跑 `tasks`，最多 `limit` 个并发。
 *
 * 不用 `Promise.all`：一批全挂的端点会把连接数一次性打满，探测自己的超时也会被
 * 挤掉，结果是「平台探测不动了」而不是「这些资产坏了」——两种故障长得一样，
 * 但只有后者是真的。
 */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await run(items[index] as T)
    }
  })
  await Promise.all(workers)
  return out
}

async function checkMcp(): Promise<HealthCheckSummary> {
  const summary: HealthCheckSummary = { ...EMPTY, kind: 'mcp', errors: [] }
  const threshold = envFailureThreshold(3)

  // `healthCheckEnabled` 已经把范围限死在 opt-in 上，`status = 'published'` 再排掉
  // 未发布的草稿——探测一个还没上架的端点只会产生无意义的外部请求。
  const rows = await db
    .select({
      id: mcpServers.id,
      connectionStatus: mcpServers.connectionStatus,
      healthFailCount: mcpServers.healthFailCount,
    })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.healthCheckEnabled, true),
        eq(mcpServers.status, 'published'),
        // `disabled` 是提供方主动停用：继续探测并因一次成功就写回 `online`，
        // 等于平台擅自推翻对方的决定。
        ne(mcpServers.connectionStatus, 'disabled'),
        isNull(mcpServers.deletedAt)
      )
    )

  await withConcurrency(rows, envConcurrency(5), async (row) => {
    summary.checked++
    try {
      const result = await mcpGatewayAccess.probeSystem(row.id)
      const healthy = result.ok

      await db
        .update(mcpServers)
        .set(healthPatch(healthy, result, threshold, mcpServers))
        .where(eq(mcpServers.id, row.id))

      if (healthy) {
        summary.healthy++
        // 只有真的从 `error` 回来才算恢复。一直是 `online` 的一次成功不算，
        // 否则「恢复」这个计数会随每轮检查无限增长。
        if (row.connectionStatus === 'error') summary.recovered++
      } else if (row.connectionStatus !== 'error') {
        // 同样是 `error` 之后的第 4、5、6 轮失败不该重复计入"下架"。
        // 只有状态真的发生 `online -> error` 才算一次下架。
        summary.takenOffline++
      } else {
        summary.degraded++
      }
    } catch (error) {
      // 探测函数本身抛错（解密失败、URL 非法等）和"探测到不健康"要分开：
      // 这里没有拿到一次真实探测结果，不能拿它去累加失败次数——否则一个配置
      // 错误会被当成端点不可用，几轮之后资产就被下架了。
      summary.errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return summary
}

async function checkA2a(): Promise<HealthCheckSummary> {
  const summary: HealthCheckSummary = { ...EMPTY, kind: 'a2a', errors: [] }
  const threshold = envFailureThreshold(3)

  const rows = await db
    .select({
      id: a2aAgents.id,
      connectionStatus: a2aAgents.connectionStatus,
      healthFailCount: a2aAgents.healthFailCount,
    })
    .from(a2aAgents)
    .where(
      and(
        eq(a2aAgents.healthCheckEnabled, true),
        eq(a2aAgents.status, 'published'),
        ne(a2aAgents.connectionStatus, 'disabled'),
        isNull(a2aAgents.deletedAt)
      )
    )

  await withConcurrency(rows, envConcurrency(5), async (row) => {
    summary.checked++
    try {
      const result = await a2aGatewayAccess.probeSystem(row.id)
      const healthy = result.ok

      await db
        .update(a2aAgents)
        .set(healthPatch(healthy, result, threshold, a2aAgents))
        .where(eq(a2aAgents.id, row.id))

      if (healthy) {
        summary.healthy++
        if (row.connectionStatus === 'error') summary.recovered++
      } else if (row.connectionStatus !== 'error') {
        summary.takenOffline++
      } else {
        summary.degraded++
      }
    } catch (error) {
      summary.errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return summary
}

/** 一轮完整检查。`/api/cron/asset-health` 与本地 cron 共用这个入口。 */
export async function runScheduledHealthChecks(): Promise<HealthCheckSummary[]> {
  return [await checkMcp(), await checkA2a()]
}