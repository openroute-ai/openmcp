import { type NextRequest, NextResponse } from 'next/server'
import {
  getSimulatedGateway,
  getTopUpGateway,
  isProductionGatewayConfigured,
  isSimulationMode,
} from '@/server/payment/gateway'
import { settleRechargeOrder } from '@/web/recharge-orders/settle'

/**
 * Alipay callback (异步通知) for the native QR (当面付 / precreate) flow.
 *
 * Development (`PAYMENT_SIMULATE=true`): accepts the simulator's signed
 * form-urlencoded body and settles through the shared service.
 *
 * Production: RSA2-verify via `AlipayTopUpGateway.verifyCallback`, then settle.
 * Alipay requires the literal string `success` to stop retrying.
 *
 * Business failures after a valid signature still return `success` so Alipay
 * does not retry forever; signature failures return `failure`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody.trim()) return new NextResponse('failure', { status: 400 })

  try {
    if (isSimulationMode()) {
      return handleSimulated(rawBody)
    }

    if (!isProductionGatewayConfigured('alipay')) {
      console.warn(
        '[alipay-webhook] production credentials not configured; refusing to credit'
      )
      return new NextResponse('failure', { status: 501 })
    }

    const fields = Object.fromEntries(new URLSearchParams(rawBody).entries())
    const tradeStatus = fields.trade_status
    if (tradeStatus && tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      // WAIT_BUYER_PAY / TRADE_CLOSED — nothing to credit.
      return new NextResponse('success')
    }

    const gateway = getTopUpGateway('alipay')
    const verified = await gateway.verifyCallback(rawBody, fields.sign ?? '', request.headers)
    if (!verified.ok) {
      console.error('[alipay-webhook] signature verification failed', verified.error)
      return new NextResponse('failure', { status: 400 })
    }

    const settlement = await settleRechargeOrder({
      orderId: verified.callback.orderId,
      reason: 'alipay_webhook',
      reportedAmount: verified.callback.amount,
      thirdPartyOrderId: verified.callback.transactionId,
      webhookData: { channel: 'alipay', raw: verified.callback.raw ?? fields },
    })

    if (!settlement.ok) {
      console.error(
        '[alipay-webhook] settlement rejected',
        settlement.code,
        settlement.error,
        verified.callback.orderId
      )
      // Valid notify, business refuse — stop retries.
      return new NextResponse('success')
    }

    return new NextResponse('success')
  } catch (error) {
    console.error('[alipay-webhook] unexpected error', error)
    return new NextResponse('failure', { status: 500 })
  }
}

async function handleSimulated(rawBody: string) {
  const fields = Object.fromEntries(new URLSearchParams(rawBody).entries())
  const orderId = fields.out_trade_no
  if (!orderId) return new NextResponse('failure', { status: 400 })

  if (fields.trade_status && fields.trade_status !== 'TRADE_SUCCESS' && fields.trade_status !== 'TRADE_FINISHED') {
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

  return new NextResponse('success')
}
