import { createId } from '@workspace/db'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balances, rechargeOrders } from '@workspace/db'

/**
 * The single place where money is credited.
 *
 * Both the WeChat/Alipay webhook and the admin bank-transfer reconciliation
 * call `settleRechargeOrder`; nothing else is allowed to move a balance. The
 * order row flip to `paid` is guarded by `status <> 'paid'` in the WHERE
 * clause, so a duplicate webhook or a second admin click updates zero rows and
 * we return `duplicate` without crediting again.
 */

export type SettleReason = 'wechat_webhook' | 'alipay_webhook' | 'bank_transfer_confirmed' | 'dev_simulated'

export type SettleResult =
  | { ok: true; alreadySettled: boolean; orderId: string; amount: string; balanceAfter: string }
  | { ok: false; code: 'NOT_FOUND' | 'AMOUNT_MISMATCH' | 'EXPIRED' | 'DB_ERROR'; error: string }

/** Amounts are compared on their integer minor unit to dodge float drift. */
const toMinorUnits = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export async function settleRechargeOrder(params: {
  orderId: string
  reason: SettleReason
  /**
   * Amount the gateway reported, in major units. For a real callback this is
   * the signed `total_amount`; a mismatch aborts the settlement.
   */
  reportedAmount?: string | number
  thirdPartyOrderId?: string
  webhookData?: Record<string, unknown>
}): Promise<SettleResult> {
  const [order] = await db
    .select()
    .from(rechargeOrders)
    .where(eq(rechargeOrders.orderId, params.orderId))
    .limit(1)

  if (!order) return { ok: false, code: 'NOT_FOUND', error: '订单不存在' }

  if (order.status === 'paid') {
    const [existing] = await db
      .select({ amount: balances.amount })
      .from(balances)
      .where(eq(balances.userId, order.userId))
      .limit(1)
    return {
      ok: true,
      alreadySettled: true,
      orderId: order.orderId,
      amount: order.amount.toString(),
      balanceAfter: existing?.amount?.toString() ?? '0',
    }
  }

  // A signed callback that reports a different amount than we created is a
  // tampering signal, not a rounding issue. Refuse rather than guess.
  if (params.reportedAmount !== undefined) {
    const expected = toMinorUnits(order.amount)
    const actual = toMinorUnits(params.reportedAmount)
    if (expected === null || actual === null || expected !== actual) {
      return {
        ok: false,
        code: 'AMOUNT_MISMATCH',
        error: `订单金额不匹配：期望 ${order.amount.toString()}，回调 ${params.reportedAmount}`,
      }
    }
  }

  // Bank transfers legitimately sit in `pending_transfer` for a long time, so
  // only the online channels are subject to the expiry window.
  if (order.type !== 'bank_transfer' && order.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED', error: '订单已过期' }
  }

  const amount = order.amount.toString()
  const credits = order.credits.toString()

  const result = await db.transaction(async (tx) => {
    // Idempotency guard: only a row that is still not `paid` can be claimed.
    const claimed = await tx
      .update(rechargeOrders)
      .set({
        status: 'paid',
        paidAt: new Date(),
        updatedAt: new Date(),
        webhookReceived: true,
        webhookData: params.webhookData ?? order.webhookData,
        thirdPartyOrderId: params.thirdPartyOrderId ?? order.thirdPartyOrderId,
        remark: order.remark ?? params.reason,
      })
      .where(
        and(
          eq(rechargeOrders.orderId, params.orderId),
          sql`${rechargeOrders.status} <> 'paid'`
        )
      )
      .returning({ orderId: rechargeOrders.orderId, userId: rechargeOrders.userId })

    // Lost the race: another webhook or admin already settled this order.
    if (!claimed || claimed.length === 0) return null

    // Wallets are created lazily on first top-up; a purchase attempt by a user
    // with no wallet row should not silently create a zero balance here.
    await tx
      .update(balances)
      .set({
        amount: sql`${balances.amount} + ${amount}::numeric`,
        amountTotal: sql`${balances.amountTotal} + ${amount}::numeric`,
        credits: sql`${balances.credits} + ${credits}::numeric`,
        creditsTotal: sql`${balances.creditsTotal} + ${credits}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(balances.userId, claimed[0]!.userId))

    const [after] = await tx
      .select({ amount: balances.amount })
      .from(balances)
      .where(eq(balances.userId, claimed[0]!.userId))
      .limit(1)

    return { userId: claimed[0]!.userId, balanceAfter: after?.amount?.toString() ?? '0' }
  })

  if (result === null) {
    // Already settled by an earlier delivery. Report the user's real balance
    // rather than a placeholder: a callback retry should be able to tell the
    // payer what they now have, and a UI must never show a fabricated 0.
    // `order` was read before the transaction, so it is the authoritative
    // owner of this orderId — the lost race does not change that.
    const [existing] = await db
      .select({ amount: balances.amount })
      .from(balances)
      .where(eq(balances.userId, order.userId))
      .limit(1)

    return {
      ok: true,
      alreadySettled: true,
      orderId: params.orderId,
      amount,
      balanceAfter: existing?.amount?.toString() ?? '0',
    }
  }

  return {
    ok: true,
    alreadySettled: false,
    orderId: params.orderId,
    amount,
    balanceAfter: result.balanceAfter,
  }
}

/**
 * Ensures a wallet row exists so later top-ups have something to credit.
 * Called when an order is created, not at settlement time.
 */
export async function ensureWallet(userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: balances.id })
    .from(balances)
    .where(eq(balances.userId, userId))
    .limit(1)
  if (existing) return
  await db
    .insert(balances)
    .values({ id: createId(), userId, currency: 'CNY' })
    .onConflictDoNothing()
}
