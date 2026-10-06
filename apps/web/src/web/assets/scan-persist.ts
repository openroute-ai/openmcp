/**
 * 把元数据扫描结果落库（MCP / A2A 通用）。
 *
 * 刻意做成"扫描失败不影响注册"：规则扫描是纯本地计算，出错说明代码问题而不是
 * 资产问题，此时把注册一起回滚会让提供方白白重填一次表单。失败时保持
 * `securityLevel = 'unknown'`，让前端显示「未扫描」——这比写入一个假的 `safe`
 * 诚实，也比直接卡住注册更可用。
 */

import { and, eq, ne } from 'drizzle-orm'
import { a2aAgents, mcpServers } from '@workspace/db'
import { db } from '@/lib/db'
import { scanGatewayMetadata, type GatewayScanInput } from '@workspace/security-scan'
import { notDeleted } from './visibility'

export interface PersistScanOutcome {
  scanned: boolean
  grade: string | null
  reason?: string
}

export async function persistMcpScan(serverId: string, input: GatewayScanInput): Promise<PersistScanOutcome> {
  const result: any = scanGatewayMetadata(input)
  await db
    .update(mcpServers)
    .set({
      securityLevel: result.grade,
      securityGrade: result.grade,
      securityFlags: result.flags,
      securityLlmGrade: null,
      scannedAt: result.scannedAt,
      scanRulesVersion: result.rulesVersion,
    })
    .where(and(eq(mcpServers.id, serverId)))
  return { scanned: true, grade: result.grade }
}

export async function persistA2aScan(agentId: string, input: GatewayScanInput): Promise<PersistScanOutcome> {
  const result: any = scanGatewayMetadata(input)
  await db
    .update(a2aAgents)
    .set({
      securityLevel: result.grade,
      securityGrade: result.grade,
      securityFlags: result.flags,
      securityLlmGrade: null,
      scannedAt: result.scannedAt,
      scanRulesVersion: result.rulesVersion,
    })
    .where(and(eq(a2aAgents.id, agentId)))
  return { scanned: true, grade: result.grade }
}
/** 规则集升级后，找出需要重扫的资产 id（仅未删除、未归档的）。 */
export async function findStaleMcpScans(currentRulesVersion: string, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(and(notDeleted(mcpServers), ne(mcpServers.scanRulesVersion, currentRulesVersion)))
    .limit(limit)
  return rows.map((r) => r.id)
}

export async function findStaleA2aScans(currentRulesVersion: string, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: a2aAgents.id })
    .from(a2aAgents)
    .where(and(notDeleted(a2aAgents), ne(a2aAgents.scanRulesVersion, currentRulesVersion)))
    .limit(limit)
  return rows.map((r) => r.id)
}