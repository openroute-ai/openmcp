/**
 * 商店安装工具（`install_asset`）解析可安装的 MCP/A2A 资产。
 *
 * 过滤条件必须和市场列表一致（`marketVisible`）：已发布 且 未删除 且 连接在线。
 * 只查 `status === 'published'` 是不够的 —— 提供方删除或停用一个资产后，它
 * 仍然 `published`，而这里的 id/slug 解析是安装路径的实际入口，于是买家能
 * 通过 MCP 工具装到一个已下架或端点已死的资产，拿到一个必然调不通的
 * `gatewayUrl`。
 *
 * 单独成模块而不是留在 `tools.ts`：这里是纯数据访问，把它和 auth/oauth/
 * litellm 那条工具链解耦，生命周期集成测试才能在不拉起整个商店服务端栈的
 * 前提下直接验证安装入口的可见性规则。
 */
import { and, eq } from "drizzle-orm"
import { a2aAgents, mcpServers } from "@workspace/db"
import { db } from "@/lib/db"
import { marketVisible } from "@/web/assets/visibility"

export async function resolveMcp(idOrSlug: string) {
  const byId = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, idOrSlug), marketVisible(mcpServers)))
    .limit(1)
  if (byId[0]) return byId[0]
  const bySlug = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.slug, idOrSlug), marketVisible(mcpServers)))
    .limit(1)
  return bySlug[0] ?? null
}

export async function resolveA2a(idOrSlug: string) {
  const byId = await db
    .select()
    .from(a2aAgents)
    .where(and(eq(a2aAgents.id, idOrSlug), marketVisible(a2aAgents)))
    .limit(1)
  if (byId[0]) return byId[0]
  const bySlug = await db
    .select()
    .from(a2aAgents)
    .where(and(eq(a2aAgents.slug, idOrSlug), marketVisible(a2aAgents)))
    .limit(1)
  return bySlug[0] ?? null
}
