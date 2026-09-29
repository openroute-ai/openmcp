import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  CreateTopUpParams,
  TopUpCallback,
  TopUpGateway,
  TopUpSession,
  VerifyTopUpCallbackResult,
} from './types'

/**
 * Development-only top-up gateway.
 *
 * It reproduces the shape of a real WeChat/Alipay callback — signed payload,
 * `verifyCallback` rejects a bad signature, the caller then settles through
 * the normal settlement service — but it never contacts a payment network.
 *
 * The signing key is a local constant, not a credential: a production deploy
 * must not be able to use this gateway, so `assertSimulationAllowed` is called
 * by the host and this module refuses to construct without an explicit opt-in.
 */

const DEV_SIGNING_KEY = 'openmcp-dev-payment-simulation'
const DEV_TOKEN_TTL_MS = 15 * 60 * 1000

export const isPaymentSimulationEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.PAYMENT_SIMULATE === 'true'

/** Throws if a simulated gateway is constructed in a production build. */
export function assertSimulationAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[payment] The simulated gateway cannot be used in production. Set PAYMENT_SIMULATE only in development.'
    )
  }
}

const sign = (payload: string): string =>
  createHash('sha256').update(`${payload}.${DEV_SIGNING_KEY}`).digest('hex')

export class SimulatedTopUpGateway implements TopUpGateway {
  readonly channel: 'wechat' | 'alipay'

  constructor(channel: 'wechat' | 'alipay' = 'wechat') {
    assertSimulationAllowed()
    this.channel = channel
  }

  async createTopUp(params: CreateTopUpParams): Promise<TopUpSession> {
    assertSimulationAllowed()
    const expiresAt = new Date(Date.now() + DEV_TOKEN_TTL_MS)

    // Stands in for the gateway-issued pre-create token. It is only meaningful
    // to this simulator, which is why it embeds the signing key material.
    const token = sign(
      JSON.stringify({ orderId: params.orderId, amount: params.amount, exp: expiresAt.getTime() })
    )
    const qrPayload =
      this.channel === 'wechat'
        ? `weixin://wxpay/bizpayurl?pr=${token}`
        : `https://sim.openmcp.local/alipay/scan?token=${token}`

    return {
      orderId: params.orderId,
      channel: this.channel,
      redirectUrl: `${params.origin}/api/pay/simulate/${params.orderId}?token=${token}`,
      qrPayload,
      returnUrl: `${params.origin}/settings/recharge?orderId=${params.orderId}`,
      expiresAt,
    }
  }

  /**
   * Mints the body a real callback would carry, so the verification path below
   * is exercised for real rather than stubbed out.
   */
  issueCallback(orderId: string, amount: string, transactionId?: string): {
    payload: string
    signature: string
  } {
    assertSimulationAllowed()
    const callback: TopUpCallback = {
      orderId,
      amount,
      channel: this.channel,
      transactionId: transactionId ?? `sim_${randomUUID().slice(0, 8)}`,
    }
    const payload = JSON.stringify(callback)
    return { payload, signature: sign(payload) }
  }

  async verifyCallback(payload: string, signature: string): Promise<VerifyTopUpCallbackResult> {
    assertSimulationAllowed()
    const expected = sign(payload)
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature ?? '', 'utf8')
    // Length check first: timingSafeEqual throws on a length mismatch, which
    // would turn a bad signature into a 500 instead of a clean rejection.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: 'Invalid simulated callback signature' }
    }
    try {
      const parsed = JSON.parse(payload) as TopUpCallback
      if (!parsed.orderId || !parsed.amount) {
        return { ok: false, error: 'Simulated callback is missing orderId or amount' }
      }
      return { ok: true, callback: parsed }
    } catch {
      return { ok: false, error: 'Simulated callback payload is not valid JSON' }
    }
  }
}
