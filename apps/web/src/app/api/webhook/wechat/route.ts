import { type NextRequest, NextResponse } from 'next/server'

/**
 * WeChat Pay callback (支付结果通知).
 *
 * Production route, and the correct shape of a WeChat notification: XML body,
 * signature in a request header, answer with a plain-text ACK.
 *
 * The real `TopUpGateway.verifyCallback` adapter for WeChat is not implemented
 * yet (see `docs/payment-plan.md` §3.3), so this route deliberately refuses
 * rather than crediting from an unverified body. WeChat retries anything that
 * is not `success`, so an unconfigured deployment degrades to "nothing is
 * credited" instead of accepting a forged callback.
 *
 * The dev flow uses `POST /api/pay/simulate/[orderId]`, which mints a signed
 * body and runs it through the same `settleRechargeOrder` call this route will
 * use once the verifier lands.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody.trim()) {
    return new NextResponse('failure', { status: 400 })
  }

  const signature = request.headers.get('Wechatpay-Signature')

  // TODO(payment): verify the signature via the gateway, then
  //   const { callback } = await gateway.verifyCallback(rawBody, signature)
  //   await settleRechargeOrder({ orderId: callback.orderId, reason: 'wechat_webhook', ... })
  // Return `success` on settlement, and keep returning `success` for business
  // failures so WeChat does not retry forever — alert instead.
  console.warn(
    '[wechat-webhook] verifier not wired; refusing to credit. signature=%s body=%s',
    signature ? 'present' : 'missing',
    rawBody.slice(0, 200)
  )

  return new NextResponse('failure', { status: 501 })
}
