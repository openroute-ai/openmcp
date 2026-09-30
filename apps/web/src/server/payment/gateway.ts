import {
  AlipayTopUpGateway,
  isPaymentSimulationEnabled,
  SimulatedTopUpGateway,
  WeChatTopUpGateway,
} from '@workspace/payment/topup'
import type { SimulatedTopUpGateway as SimulatedGateway } from '@workspace/payment/topup'
import type { TopUpChannel, TopUpGateway } from '@workspace/payment/topup'
import { websiteConfig } from '@/lib/config/website'
import {
  missingAlipayTopUpKeys,
  missingWeChatTopUpKeys,
  resolveAlipayTopUpCredentials,
  resolveWeChatTopUpCredentials,
} from './config'

/**
 * Resolves the top-up gateway for a channel.
 *
 * In development with `PAYMENT_SIMULATE=true` this returns the simulator, which
 * reproduces the callback signature/verify flow without a payment network. The
 * settlement path behind it is the same one production uses, so the business
 * flow is exercised end to end.
 *
 * A production build never gets the simulator: `SimulatedTopUpGateway` throws if
 * constructed with `NODE_ENV=production`, and the guard below fails closed
 * first so the error message is about the missing configuration.
 *
 * When simulation is off, a real WeChat (API v3 Native) or Alipay (precreate)
 * adapter is constructed from env credentials. Missing credentials throw so
 * callers (createPayment / webhooks) can surface a clear 501 / error instead of
 * silently accepting an unverified body.
 */

const gateways = new Map<TopUpChannel, TopUpGateway>()

/**
 * The simulator with its dev-only `issueCallback`, which is intentionally not
 * part of `TopUpGateway` so production code cannot mint a signed callback.
 * Resolving through this helper keeps that guarantee while letting the dev
 * route reach the method.
 */
export function getSimulatedGateway(channel: TopUpChannel): SimulatedGateway {
  const gateway = getTopUpGateway(channel)
  if (!(gateway instanceof SimulatedTopUpGateway)) {
    throw new Error('[payment] issueCallback is only available on the simulated gateway')
  }
  return gateway
}

export function isSimulationMode(): boolean {
  return isPaymentSimulationEnabled()
}

/** True when the named channel has every credential needed for a real gateway. */
export function isProductionGatewayConfigured(channel: TopUpChannel): boolean {
  if (channel === 'wechat') return missingWeChatTopUpKeys().length === 0
  return missingAlipayTopUpKeys().length === 0
}

export function getTopUpGateway(channel: TopUpChannel): TopUpGateway {
  const cached = gateways.get(channel)
  if (cached) return cached

  if (isSimulationMode()) {
    const gateway = new SimulatedTopUpGateway(channel)
    gateways.set(channel, gateway)
    return gateway
  }

  const gateway = createProductionGateway(channel)
  gateways.set(channel, gateway)
  return gateway
}

function createProductionGateway(channel: TopUpChannel): TopUpGateway {
  if (channel === 'wechat') {
    const creds = resolveWeChatTopUpCredentials()
    if (!creds) {
      const missing = missingWeChatTopUpKeys()
      throw new Error(
        `[payment] WeChat top-up gateway is not configured (missing: ${missing.join(', ')}). ` +
          'Set the WECHAT_* credentials, or PAYMENT_SIMULATE=true in development.'
      )
    }
    return new WeChatTopUpGateway(creds)
  }

  const creds = resolveAlipayTopUpCredentials()
  if (!creds) {
    const missing = missingAlipayTopUpKeys()
    throw new Error(
      `[payment] Alipay top-up gateway is not configured (missing: ${missing.join(', ')}). ` +
        'Set the ALIPAY_* credentials, or PAYMENT_SIMULATE=true in development.'
    )
  }
  return new AlipayTopUpGateway(creds)
}

/** Channel configured for online payment, falling back to bank transfer. */
export function resolveOnlineChannel(): TopUpChannel {
  const provider = websiteConfig.payment.provider
  if (provider === 'wechat') return 'wechat'
  if (provider === 'alipay') return 'alipay'
  return 'wechat'
}
