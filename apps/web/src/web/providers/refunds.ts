/**
 * 退款：撤销买家权益 + 退回余额 + 生成负向 clawback 收入行。
 *
 * 三步在**一个事务**里，顺序不能换：
 *
 *   1. `SELECT ... FOR UPDATE` 锁住 entitlement，并要求 `status = 'active'`
 *   2. 权益置 `revoked`，金额退回买家余额
 *   3. 写一条 `kind = 'clawback'` 的负收入行，`reverses_earning_id` 指回原销售行
 *
 * 为什么必须是一个事务：步骤 1 的 `status = 'active'` 是唯一的重复退款闸门。
 * 两个并发请求都能读到 `active`，只有 `FOR UPDATE` 让第二个等待并看到
 * 已经变成 `revoked` 的结果——否则会退两次钱、冲两次分成。
 *
 * 为什么不删原销售行：账单是按月聚合 `provider_earnings` 的，删掉会让
 * 创作者当月的账单凭空少一笔，看起来像平台吞了钱。补一条负数行后，
 * 账单里 `sale` 与 `clawback` 两行同时在，两边都能对上账。
 *
 * 钱退回**平台余额**而非原路：钱包是站内唯一的可退渠道，且原支付渠道
 * （微信/支付宝/对公转账）退款需要各自的商户 API 与资质。退款金额
 * 因此记在 `skill_entitlements.refundedAmount` 上，来源渠道流水由财务侧
 * 线下核对，不在这里伪造。
 */

import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import {
  balances,
  createId,
  providerEarnings,
  skillEntitlements,
  skills,
  user,
} from '@workspace/db'
import { db } from '@/lib/db'

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function money(value: string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export type RefundResult =
  | {
      ok: true
      entitlementId: string
      refundedAmount: number
      clawbackId: string | null
      /** 原销售行不存在（老数据或网关分成）时为 true，无行可冲。 */
      clawbackSkipped: boolean
    }
  | { ok: false; error: string }

/**
 * 退款一笔技能购买。
 *
 * `reason` 落库到 `revocationReason`，因为"为什么退"是创作者看账单时
 * 唯一能解释这笔负数的信息。
 */
export async function refundSkillEntitlement(params: {
  entitlementId: string
  adminUserId: string
  reason: string
  /** 部分退款：只退一部分，clawback 按退款比例冲。缺省全额退。 */
  amount?: number
}): Promise<RefundResult> {
  const reason = params.reason.trim()
  if (!reason) return { ok: false, error: '请填写退款原因' }

  const requested = params.amount
  if (requested != null && (!Number.isFinite(requested) || requested <= 0)) {
    return { ok: false, error: '退款金额无效' }
  }

  try {
    return await db.transaction(async (tx) => {
      const [entitlement] = await tx
        .select()
        .from(skillEntitlements)
        .where(eq(skillEntitlements.id, params.entitlementId))
        .limit(1)
        .for('update')

      if (!entitlement) return { ok: false as const, error: '订单不存在' }
      if (entitlement.status === 'revoked') {
        return { ok: false as const, error: '该订单已退款，不能重复退款' }
      }

      const original = money(entitlement.amount)
      const alreadyRefunded = money(entitlement.refundedAmount)
      const remaining = original - alreadyRefunded
      if (remaining <= 0) {
        return { ok: false as const, error: '该订单已全额退款' }
      }

      const refund = requested == null ? remaining : Math.min(requested, remaining)
      const refundStr = round2(refund)

      await tx
        .update(skillEntitlements)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revocationReason: reason,
          refundedAmount: round2(alreadyRefunded + refund),
          refundedAt: new Date(),
          // 谁批的。退款是资金流出，没有这个字段就无法在买家投诉时回答
          // "谁退的"，也无法追责。
          refundedBy: params.adminUserId,
        })
        .where(and(eq(skillEntitlements.id, params.entitlementId), eq(skillEntitlements.status, 'active')))

      // 退款回到平台余额。`amountTotal` 是"账户总余额"的口径，充值时加、
      // 消费时减，退款是收入的反向，所以同样要减，避免总余额虚高。
      await tx
        .update(balances)
        .set({
          amount: sql`${balances.amount} + ${refundStr}::numeric`,
          amountTotal: sql`${balances.amountTotal} + ${refundStr}::numeric`,
          amountSpend: sql`${balances.amountSpend} - ${refundStr}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(balances.userId, entitlement.userId))

      // 找原销售行。找不到就不冲回：网关分成没有 entitlementId，退款一条
      // 没有对应收入的 clawback 只会凭空扣创作者的钱。
      const [sale] = await tx
        .select({
          id: providerEarnings.id,
          grossAmount: providerEarnings.grossAmount,
          platformFee: providerEarnings.platformFee,
          netAmount: providerEarnings.netAmount,
          authorId: providerEarnings.authorId,
          buyerUserId: providerEarnings.buyerUserId,
          skillId: providerEarnings.skillId,
          currency: providerEarnings.currency,
        })
        .from(providerEarnings)
        .where(eq(providerEarnings.entitlementId, params.entitlementId))
        .limit(1)

      if (!sale) {
        return {
          ok: true as const,
          entitlementId: entitlement.id,
          refundedAmount: refund,
          clawbackId: null,
          clawbackSkipped: true,
        }
      }

      // 按退款比例冲回。全额退款得到完全相反的一行，比例退款得到对应的
      // 负数行——所以部分退款同样能进账单，而不是留下没收掉的差额。
      const ratio = original > 0 ? refund / original : 0
      const clawbackId = createId()

      await tx.insert(providerEarnings).values({
        id: clawbackId,
        authorId: sale.authorId,
        buyerUserId: sale.buyerUserId,
        skillId: sale.skillId,
        entitlementId: entitlement.id,
        reversesEarningId: sale.id,
        kind: 'clawback',
        grossAmount: round2(-money(sale.grossAmount) * ratio),
        platformFee: round2(-money(sale.platformFee) * ratio),
        netAmount: round2(-money(sale.netAmount) * ratio),
        currency: sale.currency,
        status: 'payable',
      })

      return {
        ok: true as const,
        entitlementId: entitlement.id,
        refundedAmount: refund,
        clawbackId,
        clawbackSkipped: false,
      }
    })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '退款失败',
    }
  }
}
/**
 * 后台可退款权益列表。
 *
 * 退款接口需要一个入口，但后台此前没有任何地方能列出 `skill_entitlements`
 * ——只能靠手写 API 调用去猜 id。这条查询就是那个入口。
 *
 * 默认只列 `active`（还能退的），`status: 'all'` 才带上已撤销的——默认列
 * 已撤销的行会让运营对着一个已经退过的权益再点一次退款，然后拿到"已退款"
 * 错误，看起来像系统坏了。
 *
 * `total` 是独立的 `count(*)`，不是 `rows.length`：分页时后者只是当页行数，
 * 拿它当总数会让"共 3 条"在翻到第二页后变成"共 20 条"。
 */
export async function adminListRefundableEntitlements(
  options: {
    status?: 'active' | 'revoked' | 'all'
    search?: string
    limit?: number
    offset?: number
  } = {}
) {
  const { status = 'active', search, limit = 50, offset = 0 } = options

  const conditions = []
  if (status !== 'all') conditions.push(eq(skillEntitlements.status, status))

  const keyword = search?.trim()
  if (keyword) {
    // 同时匹配买家邮箱、Skill 名和订单号：运营接到投诉时手里通常只有其中
    // 一个（邮箱或订单号），只匹配其中一个会让另一半的工单没法处理。
    const pattern = `%${keyword}%`
    const like = or(
      ilike(user.email, pattern),
      ilike(skills.title, pattern),
      ilike(skillEntitlements.orderId, pattern),
      ilike(skillEntitlements.id, pattern)
    )
    if (like) conditions.push(like)
  }

  const where = conditions.length ? and(...conditions) : undefined

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: skillEntitlements.id,
        userId: skillEntitlements.userId,
        buyerEmail: user.email,
        skillId: skillEntitlements.skillId,
        skillName: skills.title,
        orderId: skillEntitlements.orderId,
        amount: skillEntitlements.amount,
        currency: skillEntitlements.currency,
        status: skillEntitlements.status,
        refundedAmount: skillEntitlements.refundedAmount,
        refundedBy: skillEntitlements.refundedBy,
        revokedAt: skillEntitlements.revokedAt,
        revocationReason: skillEntitlements.revocationReason,
        createdAt: skillEntitlements.createdAt,
      })
      .from(skillEntitlements)
      .leftJoin(user, eq(skillEntitlements.userId, user.id))
      .leftJoin(skills, eq(skillEntitlements.skillId, skills.id))
      .where(where)
      .orderBy(desc(skillEntitlements.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({
        total: count(),
        refundable: sql<string>`coalesce(sum(${skillEntitlements.amount} - coalesce(${skillEntitlements.refundedAmount}, 0)), 0)`,
      })
      .from(skillEntitlements)
      .leftJoin(user, eq(skillEntitlements.userId, user.id))
      .leftJoin(skills, eq(skillEntitlements.skillId, skills.id))
      .where(where),
  ])

  return {
    total: totals?.total ?? 0,
    refundableTotal: money(totals?.refundable),
    list: rows.map((row) => ({
      ...row,
      amount: money(row.amount),
      refundedAmount: money(row.refundedAmount),
      /** 还能退多少。全额未退时等于 `amount`。 */
      refundable: money(row.amount) - money(row.refundedAmount),
    })),
  }
}
