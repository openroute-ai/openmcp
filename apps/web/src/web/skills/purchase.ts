import { and, eq, sql } from 'drizzle-orm'
import { createId } from "@workspace/db"
import { db } from "@/lib/db"
import { balances, skillEntitlements, skills } from "@workspace/db"
import { creditProviderEarning } from "@/web/providers/settlement"

export type CreatePurchaseResult =
  | {
      ok: true
      alreadyOwned: boolean
      entitlementId: string
      amount: string
      currency: string
      balanceAfter: string
    }
  | {
      ok: false
      code: 'NOT_FOUND' | 'NOT_PUBLISHED' | 'NOT_PAID' | 'NO_PRICE' | 'NEED_RECHARGE' | 'BALANCE_ERROR'
      error: string
      needRecharge?: boolean
      rechargeUrl?: string
      requiredAmount?: string
      balance?: string
    }

/**
 * MVP：从用户钱包 balances.amount（CNY）扣款并写入 skill_entitlements。
 * 余额不足返回 needRecharge → /settings/recharge。微信/支付宝直连下单可后续补齐。
 */
export async function createSkillPurchase(params: {
  userId: string
  skillId: string
}): Promise<CreatePurchaseResult> {
  const [skill] = await db.select().from(skills).where(eq(skills.id, params.skillId)).limit(1)
  if (!skill) return { ok: false, code: 'NOT_FOUND', error: '技能未找到' }
  if (skill.status !== 'published') return { ok: false, code: 'NOT_PUBLISHED', error: '技能未上架' }
  if (skill.priceType !== 'paid') return { ok: false, code: 'NOT_PAID', error: '该技能为免费，无需购买' }

  const amountStr = skill.priceAmount?.toString() ?? ''
  const amount = Number(amountStr)
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 'NO_PRICE', error: '技能价格无效' }
  }
  const currency = skill.currency ?? 'CNY'

  // 只有 `active` 的权益算"已拥有"。退款把权益置为 `revoked` 但保留行，
  // 所以这里必须看 status：否则退款后买家会永久无法再次购买，因为他
  // 仍被当成"已拥有"而直接返回 `alreadyOwned`。
  const [existing] = await db
    .select()
    .from(skillEntitlements)
    .where(and(eq(skillEntitlements.userId, params.userId), eq(skillEntitlements.skillId, params.skillId)))
    .limit(1)
  if (existing && existing.status === 'active') {
    return {
      ok: true,
      alreadyOwned: true,
      entitlementId: existing.id,
      amount: existing.amount.toString(),
      currency: existing.currency,
      balanceAfter: '0',
    }
  }

  const purchaseResult = await db.transaction(async (tx) => {
    const [bal] = await tx.select().from(balances).where(eq(balances.userId, params.userId)).limit(1)
    if (!bal) {
      return {
        ok: false as const,
        code: 'NEED_RECHARGE' as const,
        error: '余额不足，请先充值',
        needRecharge: true,
        rechargeUrl: '/settings/recharge',
        requiredAmount: amountStr,
        balance: '0',
      }
    }

    const available = Number(bal.amount)
    if (!Number.isFinite(available) || available < amount) {
      return {
        ok: false as const,
        code: 'NEED_RECHARGE' as const,
        error: '余额不足，请先充值',
        needRecharge: true,
        rechargeUrl: '/settings/recharge',
        requiredAmount: amountStr,
        balance: bal.amount.toString(),
      }
    }

    const orderId = createId()
    const entitlementId = createId()

    await tx
      .update(balances)
      .set({
        amount: sql`${balances.amount} - ${amountStr}::numeric`,
        amountSpend: sql`${balances.amountSpend} + ${amountStr}::numeric`,
        amountTotal: sql`${balances.amountTotal} - ${amountStr}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(balances.userId, params.userId))

    if (existing) {
      // 重新购买被退款的技能：`skill_entitlement_user_skill_unique` 决定了
      // 不能插第二行，所以复用原行并把它从 `revoked` 复活。清空退款相关
      // 字段是为了让这一行只描述"当前这一次购买"，而不是把两次购买混在
      // 一起——上一笔的退款痕迹已经在 clawback 收入行和账单里了。
      await tx
        .update(skillEntitlements)
        .set({
          orderId,
          amount: amountStr,
          currency,
          status: 'active',
          revokedAt: null,
          revocationReason: null,
          refundedAmount: null,
          refundedAt: null,
          createdAt: new Date(),
        })
        .where(eq(skillEntitlements.id, existing.id))
    } else {
      await tx.insert(skillEntitlements).values({
        id: entitlementId,
        userId: params.userId,
        skillId: params.skillId,
        orderId,
        amount: amountStr,
        currency,
      })
    }

    // Provider 分成入账（在事务外也会成功一次；此处先记 entitlement，分成紧随）
    // 注意：credit 使用独立 insert；失败不应回滚买家授权，故放在事务后调用。

    const [after] = await tx.select({ amount: balances.amount }).from(balances).where(eq(balances.userId, params.userId)).limit(1)

    return {
      ok: true as const,
      alreadyOwned: false,
      entitlementId,
      amount: amountStr,
      currency,
      balanceAfter: after?.amount?.toString() ?? '0',
      authorId: skill.authorId,
    }
  })

  if (purchaseResult.ok && !purchaseResult.alreadyOwned && 'authorId' in purchaseResult) {
    try {
      await creditProviderEarning({
        authorId: purchaseResult.authorId,
        buyerUserId: params.userId,
        skillId: params.skillId,
        entitlementId: purchaseResult.entitlementId,
        grossAmount: purchaseResult.amount,
        currency: purchaseResult.currency,
      })
    } catch (err) {
      console.error('[skill-purchase] creditProviderEarning failed', err)
    }
    // Drop authorId from the returned payload; it is an internal join field.
    const rest = { ...purchaseResult } as Record<string, unknown>
    delete rest.authorId
    return rest as Omit<typeof purchaseResult, 'authorId'>
  }

  return purchaseResult
}

export async function hasSkillEntitlement(userId: string, skillId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: skillEntitlements.id })
    .from(skillEntitlements)
    .where(
      and(
        eq(skillEntitlements.userId, userId),
        eq(skillEntitlements.skillId, skillId),
        eq(skillEntitlements.status, 'active')
      )
    )
    .limit(1)
  return Boolean(row)
}
