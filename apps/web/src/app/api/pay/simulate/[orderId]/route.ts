import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { rechargeOrders } from '@workspace/db'
import { getSimulatedGateway, isSimulationMode } from '@/server/payment/gateway'
import { settleRechargeOrder } from '@/web/recharge-orders/settle'

/**
 * Development-only stand-in for the WeChat/Alipay callback.
 *
 * WeChat and Alipay notify a server they can reach, which a laptop cannot
 * offer. This route lets the whole flow be exercised locally: it mints the same
 * signed body a real gateway would send, pushes it through the gateway's own
 * `verifyCallback`, and only then calls the shared settlement service.
 *
 * It is NOT a bypass. The signature is still verified, the amount is still
 * cross-checked against the order, and settlement is still idempotent. The only
 * difference is who signed it.
 *
 * Gated three ways: the route returns 404 unless `PAYMENT_SIMULATE=true` and
 * `NODE_ENV !== 'production'`, the gateway refuses to construct in production,
 * and settlement still requires a real order row owned by the caller.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  if (!isSimulationMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const { orderId } = await params
    const body = (await request.json().catch(() => ({}))) as {
      outcome?: 'success' | 'fail'
      amountOverride?: string
    }

    const [order] = await db
      .select()
      .from(rechargeOrders)
      .where(eq(rechargeOrders.orderId, orderId))
      .limit(1)

    if (!order) {
      return NextResponse.json({ error: '订单不存在' }, { status: 404 })
    }
    if (order.type === 'bank_transfer') {
      return NextResponse.json(
        { error: '对公转账没有平台回调，请在管理后台核销' },
        { status: 400 }
      )
    }
    if (order.status === 'paid') {
      return NextResponse.json({ success: true, alreadySettled: true, orderId })
    }

    if (body.outcome === 'fail') {
      // Mirror a declined payment: the order stays unpaid and nothing credits.
      return NextResponse.json({ success: true, settled: false, reason: '支付失败（模拟）' })
    }

    // Report the order's own amount unless the test deliberately sends a wrong
    // one, which is how the amount-mismatch guard gets exercised.
    const reportedAmount = body.amountOverride ?? order.amount.toString()
    const channel = order.type === 'alipay' ? 'alipay' : 'wechat'
    const gateway = getSimulatedGateway(channel)

    const { payload, signature } = gateway.issueCallback(
      orderId,
      reportedAmount,
      undefined
    )
    const verified = await gateway.verifyCallback(payload, signature)
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }

    const settlement = await settleRechargeOrder({
      orderId,
      reason: 'dev_simulated',
      reportedAmount: verified.callback.amount,
      thirdPartyOrderId: verified.callback.transactionId,
      webhookData: { simulated: true, raw: verified.callback },
    })

    if (!settlement.ok) {
      // AMOUNT_MISMATCH / EXPIRED are the interesting outcomes; surface them so
      // the dev flow shows exactly what production would reject.
      return NextResponse.json(
        { success: false, code: settlement.code, error: settlement.error },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      settled: !settlement.alreadySettled,
      alreadySettled: settlement.alreadySettled,
      orderId: settlement.orderId,
      amount: settlement.amount,
      balanceAfter: settlement.balanceAfter,
    })
  } catch (error) {
    console.error('[simulate-payment] failed', error)
    return NextResponse.json({ error: '模拟支付失败' }, { status: 500 })
  }
}

/** Introspection so the dev UI can explain what it is about to do. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  if (!isSimulationMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { orderId } = await params
  const [order] = await db
    .select({
      orderId: rechargeOrders.orderId,
      amount: rechargeOrders.amount,
      status: rechargeOrders.status,
      type: rechargeOrders.type,
      expiresAt: rechargeOrders.expiresAt,
    })
    .from(rechargeOrders)
    .where(eq(rechargeOrders.orderId, orderId))
    .limit(1)

  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 })
  return NextResponse.json({ simulation: true, order })
}
