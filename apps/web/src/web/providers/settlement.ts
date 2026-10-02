import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { createId } from "@workspace/db"
import { db } from "@/lib/db"
import {
  PROVIDER_REVENUE_SHARE,
  a2aAgents,
  authors,
  mcpServers,
  providerEarnings,
  providerPayoutRequests,
  skills,
} from "@workspace/db"

export { PROVIDER_REVENUE_SHARE }

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

/** Credit provider ledger after a successful skill purchase. */
export async function creditProviderEarning(params: {
  authorId: string
  buyerUserId: string
  skillId: string
  entitlementId: string
  grossAmount: string
  currency?: string
}): Promise<{ id: string; netAmount: string; platformFee: string }> {
  const gross = Number(params.grossAmount)
  const net = gross * PROVIDER_REVENUE_SHARE
  const fee = gross - net
  const id = createId()
  await db
    .insert(providerEarnings)
    .values({
      id,
      authorId: params.authorId,
      buyerUserId: params.buyerUserId,
      skillId: params.skillId,
      entitlementId: params.entitlementId,
      kind: 'sale',
      grossAmount: round2(gross),
      platformFee: round2(fee),
      netAmount: round2(net),
      currency: params.currency ?? 'CNY',
      status: 'payable',
    })
    // 与 MCP/A2A 侧同一个部分唯一索引。少了这一句，重试入账会插出第二条收入行，
    // 创作者账单凭空多一笔平台没收到的钱。谓词必须与索引的 WHERE 逐字一致。
    .onConflictDoNothing({
      target: providerEarnings.entitlementId,
      where: sql`${providerEarnings.kind} = 'sale'`,
    })
  return { id, netAmount: round2(net), platformFee: round2(fee) }
}

/**
 * MCP / A2A 一次性购买成功后的分成入账。
 *
 * 比例、口径、`entitlement_id` 的唯一关系都与 Skill 侧一致，所以退款冲回能
 * 用同一段逻辑按 `entitlement_id` 找到这行。
 *
 * 归属写在 `asset_type` + `asset_id` 上而不是复用 `skill_id`：那两列指向
 * `skills`，填进去会在创作者账单里渲染出一个毫不相干的 Skill 名 —— 比没有
 * 归属更难解释。
 *
 * 按 `entitlement_id` 去重：授权行在购买事务里已经落库，这里是提交之后才调用，
 * 所以重试入账不会把同一笔收入算两遍。网关路径靠 `gateway_record_id` 唯一
 * 达到同样效果，这里沿用同一个思路。
 */
export async function creditAssetPurchaseEarning(params: {
  authorId: string
  buyerUserId: string
  assetType: 'mcp' | 'a2a'
  assetId: string
  entitlementId: string
  grossAmount: string
  currency?: string
}): Promise<{ id: string; netAmount: string; platformFee: string }> {
  const gross = Number(params.grossAmount)
  const net = gross * PROVIDER_REVENUE_SHARE
  const fee = gross - net
  const id = createId()
  await db
    .insert(providerEarnings)
    .values({
      id,
      authorId: params.authorId,
      buyerUserId: params.buyerUserId,
      assetType: params.assetType,
      assetId: params.assetId,
      entitlementId: params.entitlementId,
      kind: 'sale',
      grossAmount: round2(gross),
      platformFee: round2(fee),
      netAmount: round2(net),
      currency: params.currency ?? 'CNY',
      status: 'payable',
    })
    .onConflictDoNothing({
      target: providerEarnings.entitlementId,
      // 谓词必须与 `provider_earnings_entitlement_sale_unique` 的 WHERE 逐字
      // 对应，Postgres 才能推断出仲裁索引。对不上时不是"退化为普通插入"，而是
      // 整个 INSERT 报 42P10 —— 而这行是在购买事务提交后才调用的，异常被吞掉，
      // 结果是买家付了钱、授权也发了，唯独创作者一行收入都没有。
      where: sql`${providerEarnings.kind} = 'sale'`,
    })
  return { id, netAmount: round2(net), platformFee: round2(fee) }
}

/**
 * 分页入参。`pageSize` 上限 100：收益行会随调用量无限增长，不封顶的接口迟早
 * 一次性把某个大 provider 的全部历史拉下来。
 */
export const paginatedInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
})

export async function listMyEarnings(
  authorId: string,
  opts: { page?: number; pageSize?: number } = {}
) {
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const rows = await db
    .select({
      id: providerEarnings.id,
      skillId: providerEarnings.skillId,
      skillTitle: skills.title,
      // MCP / A2A 归属。买家的账单要能回答"这笔钱是哪个资产赚的"，所以和
      // `skillTitle` 一起返回：三者只有一组非空。
      assetType: providerEarnings.assetType,
      assetId: providerEarnings.assetId,
      mcpServerName: mcpServers.serverName,
      a2aAgentName: a2aAgents.agentName,
      grossAmount: providerEarnings.grossAmount,
      platformFee: providerEarnings.platformFee,
      netAmount: providerEarnings.netAmount,
      currency: providerEarnings.currency,
      status: providerEarnings.status,
      createdAt: providerEarnings.createdAt,
    })
    .from(providerEarnings)
    .leftJoin(skills, eq(providerEarnings.skillId, skills.id))
    // `asset_id` 不带跨表 FK（见迁移注释），所以归属由应用层按 `asset_type`
    // 选表连接。类型不同不能共用一个 join，所以两个都是 left join 且靠
    // `assetType` 判空 —— 一次 MCP 收入行的 `a2a_agent_name` 自然是 null。
    .leftJoin(mcpServers, eq(providerEarnings.assetId, mcpServers.id))
    .leftJoin(a2aAgents, eq(providerEarnings.assetId, a2aAgents.id))
    .where(eq(providerEarnings.authorId, authorId))
    .orderBy(desc(providerEarnings.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  // total 与聚合放在同一次往返里。汇总必须统计全部行而不是当前页——
  // 只算当前页会让"累计收入"随翻页变化。
  const [[agg], [totalRow]] = await Promise.all([
    db
      .select({
          payable: sql<string>`coalesce(sum(case when ${providerEarnings.status} = 'payable' then ${providerEarnings.netAmount} else 0 end), 0)`,
        paid: sql<string>`coalesce(sum(case when ${providerEarnings.status} = 'paid' then ${providerEarnings.netAmount} else 0 end), 0)`,
        total: sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`,
      })
      .from(providerEarnings)
      .where(eq(providerEarnings.authorId, authorId)),
    db
      .select({ n: count() })
      .from(providerEarnings)
      .where(eq(providerEarnings.authorId, authorId)),
  ])

  return {
    rows: rows.map((r) => ({
      ...r,
      grossAmount: r.grossAmount?.toString() ?? '0',
      platformFee: r.platformFee?.toString() ?? '0',
      netAmount: r.netAmount?.toString() ?? '0',
      /**
       * 展示用的来源名。`assetType` 为 null 的行（无法解析出资产的网关调用）
       * 落到 `null`，UI 显示"网关调用"而不是一个空字符串。
       */
      sourceName:
        r.skillTitle ??
        (r.assetType === 'mcp' ? r.mcpServerName : r.assetType === 'a2a' ? r.a2aAgentName : null),
    })),
    summary: {
      payable: Number(agg?.payable ?? 0),
      paid: Number(agg?.paid ?? 0),
      total: Number(agg?.total ?? 0),
      revenueShare: PROVIDER_REVENUE_SHARE,
    },
    total: totalRow?.n ?? 0,
    page,
    pageSize,
  }
}

/**
 * 老的一键提现入口，**已停用**。
 *
 * 现在走月度账单：次月 5 日出账、19 日确认截止、20 日线下打款
 * （见 `providers/statements.ts`）。两条路径并存会付两次钱：
 * 月度出账扫的是 `statement_id IS NULL` 的 `payable` 行，而这笔提现会把
 * 收入行翻成 `paid`。虽然出账现在也过滤 `payable`（已付过的行不会再被聚合成
 * 账单），但仍留着这个入口就意味着同一笔钱可以先被提现、再在账单里出现一次
 * 负向调整，账面对不上。
 *
 * 表和读取函数保留，是为了让历史上已经 `approved`/`pending` 的提现单能被财务
 * 处理完；只关掉新建入口，不动存量。
 */
export async function requestPayout(params: { userId: string; authorId: string; amount?: number }) {
  void params
  throw new Error('提现已改为按月结算：每月 5 日出账、20 日打款，请前往"我的收益"查看账单')
}

export async function listMyPayoutRequests(
  authorId: string,
  opts: { page?: number; pageSize?: number } = {}
) {
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const rows = await db
    .select()
    .from(providerPayoutRequests)
    .where(eq(providerPayoutRequests.authorId, authorId))
    .orderBy(desc(providerPayoutRequests.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return rows.map((r) => ({
    ...r,
    amount: r.amount?.toString() ?? '0',
  }))
}

export async function adminListPayoutRequests(status?: string) {
  const where = status ? eq(providerPayoutRequests.status, status as 'pending') : undefined
  const rows = await db
    .select({
      id: providerPayoutRequests.id,
      authorId: providerPayoutRequests.authorId,
      userId: providerPayoutRequests.userId,
      amount: providerPayoutRequests.amount,
      currency: providerPayoutRequests.currency,
      status: providerPayoutRequests.status,
      payoutChannel: providerPayoutRequests.payoutChannel,
      payoutAccount: providerPayoutRequests.payoutAccount,
      adminNote: providerPayoutRequests.adminNote,
      createdAt: providerPayoutRequests.createdAt,
      authorName: authors.name,
      authorUsername: authors.username,
    })
    .from(providerPayoutRequests)
    .leftJoin(authors, eq(providerPayoutRequests.authorId, authors.id))
    .where(where)
    .orderBy(desc(providerPayoutRequests.createdAt))
    .limit(100)
  return rows.map((r) => ({ ...r, amount: r.amount?.toString() ?? '0' }))
}

export async function adminUpdatePayoutRequest(params: {
  id: string
  status: 'approved' | 'rejected' | 'paid'
  adminNote?: string
}) {
  const [row] = await db.select().from(providerPayoutRequests).where(eq(providerPayoutRequests.id, params.id)).limit(1)
  if (!row) throw new Error('提现申请不存在')

  await db.transaction(async (tx) => {
    await tx
      .update(providerPayoutRequests)
      .set({
        status: params.status,
        adminNote: params.adminNote ?? row.adminNote,
        updatedAt: new Date(),
      })
      .where(eq(providerPayoutRequests.id, params.id))

    // When marked paid, mark payable earnings as paid (FIFO up to request amount)
    if (params.status === 'paid') {
      const payableRows = await tx
        .select()
        .from(providerEarnings)
        .where(and(eq(providerEarnings.authorId, row.authorId), eq(providerEarnings.status, 'payable')))
        .orderBy(providerEarnings.createdAt)
      let remaining = Number(row.amount)
      const toPay: string[] = []
      for (const e of payableRows) {
        if (remaining <= 0) break
        toPay.push(e.id)
        remaining -= Number(e.netAmount)
      }
      if (toPay.length > 0) {
        await tx.update(providerEarnings).set({ status: 'paid' }).where(inArray(providerEarnings.id, toPay))
      }
    }
  })

  return { id: params.id, status: params.status }
}
