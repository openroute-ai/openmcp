import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notDeleted } from '@/web/assets/visibility'
import { a2aAgents, assetInstalls, mcpServers } from '@workspace/db'

/**
 * 「调用即安装」的写入口。
 *
 * 平台看不到买家直连 LiteLLM 的调用（没有 proxy），所以真实的 MCP/A2A 调用
 * 由结算对账事后补记；平台内可见的调用（作者试调、Store MCP 安装）则同步记。
 * 三处共用这一个 upsert：同一 (user, asset) 只有一行，重复调用只刷新
 * `lastUsedAt` 并把状态置回 `active`。
 */

export type AssetType = 'mcp' | 'a2a'
export type AssetInstallSource = 'call' | 'trial' | 'install'

export interface AssetInstallEntry {
  userId: string
  assetType: AssetType
  assetId: string
  /** `server_name` / `agent_name`，写入时留快照。可不传（对账时不一定有）。 */
  assetName?: string | null
  source: AssetInstallSource
}

async function upsertOne(entry: AssetInstallEntry, now = new Date()): Promise<void> {
  await db
    .insert(assetInstalls)
    .values({
      userId: entry.userId,
      assetType: entry.assetType,
      assetId: entry.assetId,
      assetName: entry.assetName ?? null,
      source: entry.source,
      status: 'active',
      installedAt: now,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [assetInstalls.userId, assetInstalls.assetType, assetInstalls.assetId],
      set: {
        lastUsedAt: now,
        status: 'active',
        assetName: entry.assetName ?? null,
        source: entry.source,
        updatedAt: now,
      },
    })
}

/**
 * 记一次安装。永不抛错 —— 安装记录是附属品，它失败不该让扣款、试调或
 * 安装响应跟着失败，调用方只需要拿到一句 console 记录。
 */
export async function recordAssetInstall(entry: AssetInstallEntry): Promise<void> {
  try {
    await upsertOne(entry)
  } catch (error) {
    console.error('[asset-installs] failed to record install:', entry, error)
  }
}

/**
 * 批量记安装（结算对账用）。
 *
 * 同一批日志里同一用户对同一资产可能调用几十次，先去重成唯一 (user, asset)
 * 再 upsert —— 结果与逐条写完全一致，但只有几条 SQL。
 */
export async function recordAssetInstalls(entries: AssetInstallEntry[]): Promise<number> {
  if (entries.length === 0) return 0
  const unique = new Map<string, AssetInstallEntry>()
  for (const entry of entries) {
    unique.set(`${entry.userId}:${entry.assetType}:${entry.assetId}`, entry)
  }

  let recorded = 0
  for (const entry of unique.values()) {
    try {
      await upsertOne(entry)
      recorded += 1
    } catch (error) {
      console.error('[asset-installs] failed to record install:', entry, error)
    }
  }
  return recorded
}

/** 翻转一条 MCP/A2A 安装记录的状态，与 skill 安装的口径一致。 */
export async function setAssetInstallStatus(
  userId: string,
  installId: string,
  status: 'active' | 'removed'
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({ id: assetInstalls.id })
    .from(assetInstalls)
    .where(and(eq(assetInstalls.id, installId), eq(assetInstalls.userId, userId)))
    .limit(1)

  if (!row) return { ok: false, error: '安装记录不存在' }

  await db
    .update(assetInstalls)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(assetInstalls.id, installId), eq(assetInstalls.userId, userId)))

  return { ok: true }
}

export interface AssetInstallRow {
  id: string
  assetType: AssetType
  assetId: string
  status: string
  installedAt: Date
  lastUsedAt: Date | null
  assetName: string | null
  /** 资产当前的标题 / slug（live join），资产已删除时为 null。 */
  assetTitle: string | null
  assetSlug: string | null
  assetExists: boolean
}

/**
 * 用户的 MCP/A2A 安装记录，按安装时间倒序。
 *
 * 标题与 slug 从资产表实时取：资产改名后历史条目应显示新名字，与
 * `skill_installs` 的 left join 行为一致；`asset_name` 快照只作兜底。
 * 资产行查不到（已删或软删）时 `assetExists` 为 false，UI 据此提示。
 */
export async function listAssetInstalls(userId: string): Promise<AssetInstallRow[]> {
  const [rows, mcps, a2as] = await Promise.all([
    db
      .select()
      .from(assetInstalls)
      .where(eq(assetInstalls.userId, userId))
      .orderBy(desc(assetInstalls.installedAt)),
    db
      .select({ id: mcpServers.id, name: mcpServers.name, slug: mcpServers.slug })
      .from(mcpServers)
      .where(notDeleted(mcpServers)),
    db
      .select({ id: a2aAgents.id, name: a2aAgents.name, slug: a2aAgents.slug })
      .from(a2aAgents)
      .where(notDeleted(a2aAgents)),
  ])

  const mcpById = new Map(mcps.map((row) => [row.id, row]))
  const a2aById = new Map(a2as.map((row) => [row.id, row]))

  return rows.map((row) => {
    const asset = row.assetType === 'mcp' ? mcpById.get(row.assetId) : a2aById.get(row.assetId)
    return {
      id: row.id,
      assetType: row.assetType,
      assetId: row.assetId,
      status: row.status,
      installedAt: row.installedAt,
      lastUsedAt: row.lastUsedAt,
      assetName: row.assetName,
      assetTitle: asset?.name ?? null,
      assetSlug: asset?.slug ?? null,
      assetExists: Boolean(asset),
    }
  })
}
