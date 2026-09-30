import { type NextRequest, NextResponse } from 'next/server'
import {
  getSimulatedGateway,
  getTopUpGateway,
  isProductionGatewayConfigured,
  isSimulationMode,
} from '@/server/payment/gateway'
import { settleRechargeOrder } from '@/web/recharge-orders/settle'

/**
 * WeChat Pay callback (支付结果通知) — API v3 Native.
 *
 * Production: verify `Wechatpay-Signature`, decrypt the AES-GCM resource via
 * `WeChatTopUpGateway.verifyCallback`, then settle through the shared
 * `settleRechargeOrder` path. Respond with the JSON ACK WeChat v3 expects.
 *
 * Development: when `PAYMENT_SIMULATE=true`, accept the simulator's signed JSON
 * body (same shape as `SimulatedTopUpGateway.issueCallback`) so local testing
 * can exercise this route without a tunnel. The primary sim entry remains
 * `POST /api/pay/simulate/[orderId]`.
 *
 * Business failures after a valid signature return SUCCESS so WeChat stops
 * retrying; signature / decrypt failures return FAIL.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ackSuccess = () =>
  NextResponse.json({ code: 'SUCCESS', message: '成功' }, { status: 200 })

const ackFailure = (message: string, status = 400) =>
  NextResponse.json({ code: 'FAIL', message }, { status })

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody.trim()) {
    return ackFailure('empty body', 400)
  }

  try {
    if (isSimulationMode()) {
      return handleSimulated(rawBody, request)
    }

    if (!isProductionGatewayConfigured('wechat')) {
      console.warn(
        '[wechat-webhook] production credentials not configured; refusing to credit'
      )
      return ackFailure('gateway not configured', 501)
    }

    const gateway = getTopUpGateway('wechat')
    const signature =
      request.headers.get('Wechatpay-Signature') ??
      request.headers.get('wechatpay-signature') ??
      ''

    const verified = await gateway.verifyCallback(rawBody, signature, request.headers)
    if (!verified.ok) {
      // Non-SUCCESS trade_state is not a forgery — ACK so WeChat stops retrying.
      if (verified.error.includes('trade_state')) {
        console.info('[wechat-webhook] ignoring non-success trade', verified.error)
        return ackSuccess()
      }
      console.error('[wechat-webhook] verification failed', verified.error)
      return ackFailure(verified.error, 401)
    }

    const settlement = await settleRechargeOrder({
      orderId: verified.callback.orderId,
      reason: 'wechat_webhook',
      reportedAmount: verified.callback.amount,
      thirdPartyOrderId: verified.callback.transactionId,
      webhookData: { channel: 'wechat', raw: verified.callback.raw },
    })

    if (!settlement.ok) {
      // Valid signature but business reject: stop retries; alert via logs.
      console.error(
        '[wechat-webhook] settlement rejected',
        settlement.code,
        settlement.error,
        verified.callback.orderId
      )
      return ackSuccess()
    }

    return ackSuccess()
  } catch (error) {
    console.error('[wechat-webhook] unexpected error', error)
    return ackFailure('internal error', 500)
  }
}

async function handleSimulated(rawBody: string, request: NextRequest) {
  const gateway = getSimulatedGateway('wechat')
  const signature =
    request.headers.get('X-Simulation-Signature') ??
    request.headers.get('Wechatpay-Signature') ??
    ''

  // Simulator posts a plain TopUpCallback JSON; optional form wrap is ignored.
  let payload = rawBody
  let sig = signature
  try {
    const parsed = JSON.parse(rawBody) as { payload?: string; signature?: string }
    if (parsed.payload && parsed.signature) {
      payload = parsed.payload
      sig = parsed.signature
    }
  } catch {
    // raw body is the signed payload itself
  }

  const verified = await gateway.verifyCallback(payload, sig)
  if (!verified.ok) {
    console.error('[wechat-webhook] simulated verification failed', verified.error)
    return ackFailure(verified.error, 400)
  }

  const settlement = await settleRechargeOrder({
    orderId: verified.callback.orderId,
    reason: 'dev_simulated',
    reportedAmount: verified.callback.amount,
    thirdPartyOrderId: verified.callback.transactionId,
    webhookData: { simulated: true, raw: verified.callback },
  })

  if (!settlement.ok) {
    console.error('[wechat-webhook] simulated settlement rejected', settlement.code, settlement.error)
    return ackFailure(settlement.error, 400)
  }

  return ackSuccess()
}
