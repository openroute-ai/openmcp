/**
 * MCP/A2A 资产的可见性与可调用性判定。
 *
 * MCP Server 和 A2A Agent 是两张结构几乎一致的表，可见性规则也相同，所以
 * 规则只在这里写一次。曾经两份实现各自漂移过：MCP 用 `scope`、A2A 用
 * `visibility`，于是"停用即下架"这条规则在两边由不同代码决定。
 *
 * 三个概念不要混用：
 *
 * - `deletedAt` 非空 = **删除**。行还在，但对外完全不存在，只有提供方自己的
 *   列表和结算对账会看到它。
 * - `status !== 'published'` = **下架**（草稿/审核中/已归档/被拒）。资产完好，
 *   提供方可以重新提交上架。
 * - `connectionStatus !== 'online'` = **连接不可用**。可能是提供方主动停用，
 *   也可能是健康检查挂了。
 *
 * 市场可见 = 已发布 且 未删除 且 连接在线。第三个条件是 P3 补的：以前只查
 * `status = 'published'`，所以提供方点"停用"之后资产仍然挂在市场上、仍然能
 * 被安装和调用 —— 一个端点已死的服务继续对外收费。
 */

import { and, eq, isNull, type SQL } from "drizzle-orm"

/**
 * 判定所需的最少列集合。
 *
 * 故意只声明用到的四列，而不是接受完整的 `PgTable`：这样传入的表一旦缺少
 * `deletedAt`（例如某个新表忘了加软删除列）会在这里立刻报错，而不是等到线上
 * 才因为查不到列而 500。
 */
export type AssetVisibilityColumns = {
  status: unknown
  connectionStatus: unknown
  deletedAt: unknown
}

/** 未被软删除。任何读取资产的路径都必须带上它。 */
export function notDeleted(table: { deletedAt: unknown }): SQL {
  return isNull(table.deletedAt as Parameters<typeof isNull>[0])
}

/**
 * 可以出现在市场列表/详情页、并被安装和调用的资产。
 *
 * `connectionStatus` 也要查：提供方主动停用（`disabled`）的资产必须立刻从市场
 * 消失，否则买家会为一个端点已死的资产付款。
 */
export function marketVisible(table: AssetVisibilityColumns): SQL {
  return and(
    notDeleted(table),
    eq(table.status as Parameters<typeof eq>[0], "published"),
    eq(table.connectionStatus as Parameters<typeof eq>[0], "online")
  )!
}

/**
 * 提供方"我的资产"列表的条件：未删除，但不要求已发布或连接在线。
 *
 * 停用和下架的资产必须仍然可见 —— 否则提供方点了停用就从自己后台消失了，
 * 没有任何入口可以重新启用。
 */
export function ownedVisible(table: { deletedAt: unknown }): SQL {
  return notDeleted(table)
}
