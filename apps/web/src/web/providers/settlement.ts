import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { createId } from "@workspace/db"
import { db } from "@/lib/db"
import {
  PROVIDER_REVENUE_SHARE,
  authors,
  providerEarnings,
  providerPayoutRequests,
  providerProfiles,
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

export async function requestPayout(params: { userId: string; authorId: string; amount?: number }) {
  const earnings = await listMyEarnings(params.authorId, 1)
  const payable = earnings.summary.payable
  if (payable <= 0) throw new Error('暂无可提现余额')

  const amount = params.amount != null ? params.amount : payable
  if (amount <= 0 || amount > payable + 1e-9) throw new Error('提现金额无效')

  const [profile] = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.authorId, params.authorId))
    .limit(1)
  if (!profile || profile.payChannelStatus !== 'ready') {
    throw new Error('请先绑定收款账户')
  }
  const meta = (profile.metadata ?? {}) as {
    payoutAccounts?: Record<string, { account?: string; accountName?: string }>
  }
  const channel = profile.payChannelType === 'wechat' || profile.payChannelType === 'alipay' ? profile.payChannelType : null
  const account = channel ? meta.payoutAccounts?.[channel]?.account : null
  if (!channel || !account) throw new Error('收款账号不完整，请重新绑定')

  const [pending] = await db
    .select({ id: providerPayoutRequests.id })
    .from(providerPayoutRequests)
    .where(and(eq(providerPayoutRequests.authorId, params.authorId), eq(providerPayoutRequests.status, 'pending')))
    .limit(1)
  if (pending) throw new Error('已有待处理的提现申请')

  const id = createId()
  await db.insert(providerPayoutRequests).values({
    id,
    authorId: params.authorId,
    userId: params.userId,
    amount: round2(amount),
    currency: 'CNY',
    status: 'pending',
    payoutChannel: channel,
    payoutAccount: account,
  })
  return { id, amount: round2(amount), channel, account }
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
