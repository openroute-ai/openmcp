import { type NextRequest, NextResponse } from 'next/server'
import { getSimulatedGateway, isSimulationMode } from '@/server/payment/gateway'
import { settleRechargeOrder } from '@/web/recharge-orders/settle'

/**
 * Alipay callback (异步通知) for the native QR (当面付) flow.
 *
 * Unlike the WeChat route, this one is functional in development: when
 * `PAYMENT_SIMULATE=true` it accepts the simulator's signed form-urlencoded
 * body, which is the same shape Alipay posts, and runs it through the same
 * settlement service. That keeps the dev flow honest about the parse/verify/
 * credit ordering without a gateway.
 *
 * In production the RSA2 verifier is not wired yet, so the route refuses.
 * Alipay retries non-`success` responses.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody.trim()) return new NextResponse('failure', { status: 400 })

  if (!isSimulationMode()) {
    // TODO(payment): verify RSA2 against ALIPAY_PUBLIC_KEY, then settle.
    console.warn('[alipay-webhook] verifier not wired; refusing to credit.')
    return new NextResponse('failure', { status: 501 })
  }

  try {
    // Alipay posts application/x-www-form-urlencoded; the simulator posts the
    // same field shape so one parser covers both.
    const fields = Object.fromEntries(new URLSearchParams(rawBody).entries())
    const orderId = fields.out_trade_no
    if (!orderId) return new NextResponse('failure', { status: 400 })

    if (fields.trade_status !== 'TRADE_SUCCESS' && fields.trade_status !== 'TRADE_FINISHED') {
      // Alipay also notifies WAIT_BUYER_PAY / TRADE_CLOSED. Nothing to credit.
      return new NextResponse('success')
    }

    const gateway = getSimulatedGateway('alipay')
    const signature = fields.sign ?? ''
    const payload = fields.payload ?? rawBody
    const verified = await gateway.verifyCallback(payload, signature)
    if (!verified.ok) {
      console.error('[alipay-webhook] signature verification failed', verified.error)
      return new NextResponse('failure', { status: 400 })
    }

    const settlement = await settleRechargeOrder({
      orderId,
      reason: 'alipay_webhook',
      reportedAmount: verified.callback.amount,
      thirdPartyOrderId: verified.callback.transactionId,
      webhookData: { simulated: true, raw: fields },
    })

    if (!settlement.ok) {
      console.error('[alipay-webhook] settlement rejected', settlement.code, settlement.error)
      return new NextResponse('failure', { status: 400 })
    }

    // Alipay requires the literal string "success" to stop retrying.
    return new NextResponse('success')
  } catch (error) {
    console.error('[alipay-webhook] unexpected error', error)
    return new NextResponse('failure', { status: 500 })
  }
}
