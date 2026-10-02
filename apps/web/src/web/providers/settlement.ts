import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { createId } from "@workspace/db"
import { db } from "@/lib/db"
import {
  PROVIDER_REVENUE_SHARE,
  authors,
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
  await db.insert(providerEarnings).values({
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
  return { id, netAmount: round2(net), platformFee: round2(fee) }
}

export async function listMyEarnings(authorId: string, limit = 50) {
  const rows = await db
    .select({
      id: providerEarnings.id,
      skillId: providerEarnings.skillId,
      skillTitle: skills.title,
      grossAmount: providerEarnings.grossAmount,
      platformFee: providerEarnings.platformFee,
      netAmount: providerEarnings.netAmount,
      currency: providerEarnings.currency,
      status: providerEarnings.status,
      createdAt: providerEarnings.createdAt,
    })
    .from(providerEarnings)
    .leftJoin(skills, eq(providerEarnings.skillId, skills.id))
    .where(eq(providerEarnings.authorId, authorId))
    .orderBy(desc(providerEarnings.createdAt))
    .limit(limit)

  const [agg] = await db
    .select({
      payable: sql<string>`coalesce(sum(case when ${providerEarnings.status} = 'payable' then ${providerEarnings.netAmount} else 0 end), 0)`,
      paid: sql<string>`coalesce(sum(case when ${providerEarnings.status} = 'paid' then ${providerEarnings.netAmount} else 0 end), 0)`,
      total: sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`,
    })
    .from(providerEarnings)
    .where(eq(providerEarnings.authorId, authorId))

  return {
    rows: rows.map((r) => ({
      ...r,
      grossAmount: r.grossAmount?.toString() ?? '0',
      platformFee: r.platformFee?.toString() ?? '0',
      netAmount: r.netAmount?.toString() ?? '0',
    })),
    summary: {
      payable: Number(agg?.payable ?? 0),
      paid: Number(agg?.paid ?? 0),
      total: Number(agg?.total ?? 0),
      revenueShare: PROVIDER_REVENUE_SHARE,
    },
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

export async function listMyPayoutRequests(authorId: string) {
  const rows = await db
    .select()
    .from(providerPayoutRequests)
    .where(eq(providerPayoutRequests.authorId, authorId))
    .orderBy(desc(providerPayoutRequests.createdAt))
    .limit(50)
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
