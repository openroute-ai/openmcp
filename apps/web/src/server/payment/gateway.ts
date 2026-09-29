import { isPaymentSimulationEnabled, SimulatedTopUpGateway } from '@workspace/payment/topup'
import type { SimulatedTopUpGateway as SimulatedGateway } from '@workspace/payment/topup'
import type { TopUpChannel, TopUpGateway } from '@workspace/payment/topup'
import { websiteConfig } from '@/lib/config/website'

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

export function getTopUpGateway(channel: TopUpChannel): TopUpGateway {
  const cached = gateways.get(channel)
  if (cached) return cached

  if (isSimulationMode()) {
    const gateway = new SimulatedTopUpGateway(channel)
    gateways.set(channel, gateway)
    return gateway
  }

  throw new Error(
    `[payment] No top-up gateway is wired for "${channel}". ` +
      'A real WeChat/Alipay native-pay adapter still needs to implement TopUpGateway; ' +
      'set PAYMENT_SIMULATE=true to use the development simulator.'
  )
}

/** Channel configured for online payment, falling back to bank transfer. */
export function resolveOnlineChannel(): TopUpChannel {
  const provider = websiteConfig.payment.provider
  if (provider === 'wechat') return 'wechat'
  if (provider === 'alipay') return 'alipay'
  return 'wechat'
}
