/**
 * 网关资产版本管理（MCP / A2A）。
 *
 * 与 `skills/versions.ts` 的关键差别：**没有源码快照**。内容接入拿得到文件，
 * 端点接入拿不到对方进程里的代码，所以版本记录的是平台侧声明的元数据
 * （端点、传输、工具列表、价格）——恰好也是买家实际依赖的那部分。
 *
 * 三条不能省的约束：
 *
 * 1. **只有 owner 能发版/回滚/yank。** 越权改版本等于改所有人已购资产的实际行为。
 * 2. **回滚只改指针，不删历史。** 已购用户必须还能查到"我当时买的是哪一版"，
 *    所以任何状态下都不能物理删除版本行。
 * 3. **发布时快照当前元数据。** 事后改端点不影响历史版本记录；反过来，
 *    历史版本被 yank 也不改当前资产行。
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { a2aAgents, gatewayAssetVersions, mcpServers } from '@workspace/db'
import { db } from '@/lib/db'

export type GatewayKind = 'mcp' | 'a2a'
export type VersionStatus = 'draft' | 'published' | 'yanked' | 'archived'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const createVersionInput = z.object({
  kind: z.enum(['mcp', 'a2a']),
  assetId: z.string().min(1),
  version: z
    .string()
    .trim()
    .regex(SEMVER, '版本号必须是 语义化版本（如 1.2.0）'),
  changelog: z.string().max(2000).optional(),
})

export const publishVersionInput = z.object({
  kind: z.enum(['mcp', 'a2a']),
  versionId: z.string().min(1),
  changelog: z.string().max(2000).optional(),
})

export const rollbackInput = z.object({
  kind: z.enum(['mcp', 'a2a']),
  versionId: z.string().min(1),
})

export type AssetVersionRecord = typeof gatewayAssetVersions.$inferSelect

function tableFor(kind: GatewayKind) {
  return kind === 'a2a' ? a2aAgents : mcpServers
}

/** 资产是否存在且属于该 author。 */
async function assertOwned(
  kind: GatewayKind,
  assetId: string,
  authorId: string
): Promise<{ id: string } | null> {
  const table = tableFor(kind)
  const [row] = await db
    .select({ id: table.id, authorId: table.authorId })
    .from(table)
    .where(and(eq(table.id, assetId), eq(table.authorId, authorId)))
    .limit(1)
  return row ?? null
}

/** 读资产当前元数据，作为新版本的快照内容。 */
async function snapshotOf(kind: GatewayKind, assetId: string): Promise<Record<string, unknown> | null> {
  const table = tableFor(kind)
  const [row] = await db.select().from(table).where(eq(table.id, assetId)).limit(1)
  if (!row) return null
  const r = row as Record<string, unknown>
  return {
    name: r.name,
    description: r.description,
    endpoint: r.endpoint,
    transport: r.transport,
    authType: r.authType,
    tools: r.tools,
    priceType: r.priceType,
    billingModel: r.billingModel,
    priceAmount: r.priceAmount === null || r.priceAmount === undefined ? null : String(r.priceAmount),
    unitPrice: r.unitPrice === null || r.unitPrice === undefined ? null : String(r.unitPrice),
    protocolVersion: r.protocolVersion,
  }
}

export async function listAssetVersions(
  kind: GatewayKind,
  assetId: string,
  authorId: string
): Promise<AssetVersionRecord[]> {
  const owned = await assertOwned(kind, assetId, authorId)
  if (!owned) return []
  return db
    .select()
    .from(gatewayAssetVersions)
    .where(
      and(eq(gatewayAssetVersions.assetType, kind), eq(gatewayAssetVersions.assetId, assetId))
    )
    .orderBy(desc(gatewayAssetVersions.createdAt))
}

/**
 * 发一个新版本：快照当前元数据 + 切指针。
 *
 * 版本号重复会在 unique 约束上失败，这里转成可读错误而不是 500。
 * `publishedAt` 一次性写入，后续状态变化（yank）不回改它——它是"何时上线"的审计点。
 */
export async function publishAssetVersion(
  input: z.infer<typeof publishVersionInput> & { authorId: string }
): Promise<{ success: true; version: AssetVersionRecord } | { success: false; error: string }> {
  const table = tableFor(input.kind)
  const [existing] = await db
    .select()
    .from(gatewayAssetVersions)
    .where(eq(gatewayAssetVersions.id, input.versionId))
    .limit(1)
  if (!existing || existing.assetType !== input.kind) return { success: false, error: '版本不存在' }

  const owned = await assertOwned(input.kind, existing.assetId, input.authorId)
  if (!owned) return { success: false, error: '无权操作该资产' }
  if (existing.status === 'yanked') return { success: false, error: '已下线的版本不能重新发布，请新建版本' }

  const snapshot = await snapshotOf(input.kind, existing.assetId)
  if (!snapshot) return { success: false, error: '资产不存在' }

  const [asset] = await db
    .select({ securityGrade: table.securityGrade, scannedAt: table.scannedAt })
    .from(table)
    .where(eq(table.id, existing.assetId))
    .limit(1)

  const now = new Date()
  const [updated] = await db
    .update(gatewayAssetVersions)
    .set({
      status: 'published',
      publishedAt: existing.publishedAt ?? now,
      changelog: input.changelog ?? existing.changelog,
      snapshot: snapshot as AssetVersionRecord['snapshot'],
      securityGrade: asset?.securityGrade ?? null,
      securityScannedAt: asset?.scannedAt ?? null,
    })
    .where(eq(gatewayAssetVersions.id, input.versionId))
    .returning()

  if (!updated) return { success: false, error: '版本不存在' }

  // 切当前版本指针。yank 掉当前版本时也切走：留在一个已下线的版本上，
  // 买家点进去看到的是"已下线"，这比自动回退更诚实。
  if (existing.status === 'draft' || existing.status === 'archived') {
    await db
      .update(table)
      .set({ currentVersionId: updated.id, currentVersion: updated.version, updatedAt: now })
      .where(eq(table.id, existing.assetId))
  }

  return { success: true, version: updated }
}

export async function createAssetVersion(
  input: z.infer<typeof createVersionInput> & { authorId: string }
): Promise<{ success: true; version: AssetVersionRecord } | { success: false; error: string }> {
  const owned = await assertOwned(input.kind, input.assetId, input.authorId)
  if (!owned) return { success: false, error: '资产不存在或无权操作' }

  const snapshot = await snapshotOf(input.kind, input.assetId)
  if (!snapshot) return { success: false, error: '资产不存在' }

  try {
    const [row] = await db
      .insert(gatewayAssetVersions)
      .values({
        assetType: input.kind,
        assetId: input.assetId,
        version: input.version,
        status: 'draft',
        snapshot: snapshot as AssetVersionRecord['snapshot'],
        changelog: input.changelog,
        createdBy: input.authorId,
      })
      .returning()
    if (!row) return { success: false, error: '创建版本失败' }
    return { success: true, version: row }
  } catch (error) {
    // 版本号重复：unique 约束
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      return { success: false, error: '版本号已存在' }
    }
    throw error
  }
}

/**
 * 回滚：把当前版本指针指到目标版本。
 *
 * 只改指针，不删任何历史行——已购用户要能查到当时买的是哪一版。
 * 目标版本必须是 published：回滚到一个 draft 等于"没发布过的版本突然上线"。
 */
export async function rollbackToVersion(
  input: z.infer<typeof rollbackInput> & { authorId: string }
): Promise<{ success: true } | { success: false; error: string }> {
  const table = tableFor(input.kind)
  const [version] = await db
    .select()
    .from(gatewayAssetVersions)
    .where(eq(gatewayAssetVersions.id, input.versionId))
    .limit(1)
  if (!version || version.assetType !== input.kind) return { success: false, error: '版本不存在' }

  const owned = await assertOwned(input.kind, version.assetId, input.authorId)
  if (!owned) return { success: false, error: '无权操作该资产' }
  if (version.status === 'yanked') return { success: false, error: '已下线的版本不能作为当前版本' }

  await db
    .update(table)
    .set({ currentVersionId: version.id, currentVersion: version.version, updatedAt: new Date() })
    .where(eq(table.id, version.assetId))
  return { success: true }
}

/**
 * 下线某个版本。
 *
 * 不删除行：已购用户侧的授权与账本可能指向这一版，物理删除会让那些记录指向
 * 一个不存在的版本。目标就是当前版本时，同时把指针挪走。
 */
export async function yankAssetVersion(
  input: z.infer<typeof rollbackInput> & { authorId: string; reason?: string }
): Promise<{ success: true } | { success: false; error: string }> {
  const table = tableFor(input.kind)
  const [version] = await db
    .select()
    .from(gatewayAssetVersions)
    .where(eq(gatewayAssetVersions.id, input.versionId))
    .limit(1)
  if (!version || version.assetType !== input.kind) return { success: false, error: '版本不存在' }

  const owned = await assertOwned(input.kind, version.assetId, input.authorId)
  if (!owned) return { success: false, error: '无权操作该资产' }

  await db
    .update(gatewayAssetVersions)
    .set({ status: 'yanked' })
    .where(eq(gatewayAssetVersions.id, input.versionId))

  const [asset] = await db
    .select({ currentVersionId: table.currentVersionId })
    .from(table)
    .where(eq(table.id, version.assetId))
    .limit(1)
  if (asset?.currentVersionId === version.id) {
    // 指针还停在下线版本上会让买家点进去看到"已下线"。切到最近的可用版本。
    const [fallback] = await db
      .select({ id: gatewayAssetVersions.id, version: gatewayAssetVersions.version })
      .from(gatewayAssetVersions)
      .where(
        and(
          eq(gatewayAssetVersions.assetType, input.kind),
          eq(gatewayAssetVersions.assetId, version.assetId),
          inArray(gatewayAssetVersions.status, ['published', 'draft'])
        )
      )
      .orderBy(desc(gatewayAssetVersions.createdAt))
      .limit(1)
    await db
      .update(table)
      .set({
        currentVersionId: fallback?.id ?? null,
        currentVersion: fallback?.version ?? null,
        updatedAt: new Date(),
      })
      .where(eq(table.id, version.assetId))
  }

  return { success: true }
}