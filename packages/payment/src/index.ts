import { AlipayProvider } from './provider/alipay'
import { StripeProvider } from './provider/stripe'
import { WeChatPayProvider } from './provider/wechat'
import type { PaymentProviderDeps } from './repository'
import type { PaymentProvider } from './types'

export { AlipayProvider } from './provider/alipay'
export { StripeProvider } from './provider/stripe'
export { WeChatPayProvider } from './provider/wechat'
export * from './types'
export type {
  CreatePaymentRecord,
  PaymentNotifier,
  PaymentProviderDeps,
  PaymentRecord,
  PaymentRepository,
  PlanLookup,
} from './repository'
export * as AlipayUtils from './utils/alipay-utils'
export * as WeChatUtils from './utils/wechat-utils'

export type PaymentProviderName = 'stripe' | 'alipay' | 'wechat'

/**
 * Configuration for a single payment provider, as read from the environment.
 *
 * The package validates and stores these values; it does not read `process.env`
 * itself, so a missing key surfaces where the app wires the provider up.
 */
export interface PaymentProviderConfig {
  provider: PaymentProviderName
  /** Shared secrets for the selected provider. */
  credentials: Record<string, string | undefined>
  /** Selects the production gateway for providers that offer a sandbox. */
  isProduction?: boolean
}

/**
 * Validates that every credential the selected provider needs is present.
 *
 * Returns the list of missing keys so a misconfigured deployment reports all of
 * them at once instead of one per restart.
 */
export const missingCredentials = (
  config: PaymentProviderConfig
): string[] => {
  const required: Record<PaymentProviderName, string[]> = {
    stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    alipay: ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY'],
    wechat: [
      'WECHAT_APP_ID',
      'WECHAT_MCH_ID',
      'WECHAT_API_KEY',
      'WECHAT_PRIVATE_KEY',
    ],
  }

  return required[config.provider].filter((key) => !config.credentials[key])
}

/**
 * Creates a payment provider from an explicit config plus injected dependencies.
 */
export const createPaymentProvider = (
  config: PaymentProviderConfig,
  deps: PaymentProviderDeps
): PaymentProvider => {
  const { provider, credentials, isProduction = false } = config

  const missing = missingCredentials(config)
  if (missing.length > 0) {
    throw new Error(
      `${provider} payment provider is missing credentials: ${missing.join(', ')}`
    )
  }

  switch (provider) {
    case 'stripe':
      return new StripeProvider({
        apiKey: credentials.STRIPE_SECRET_KEY as string,
        webhookSecret: credentials.STRIPE_WEBHOOK_SECRET as string,
        ...deps,
      })
    case 'alipay':
      return new AlipayProvider(
        {
          appId: credentials.ALIPAY_APP_ID as string,
          privateKey: credentials.ALIPAY_PRIVATE_KEY as string,
          publicKey: credentials.ALIPAY_PUBLIC_KEY as string,
          gateway:
            credentials.ALIPAY_GATEWAY ??
            (isProduction
              ? 'https://openapi.alipay.com/gateway.do'
              : 'https://openapi.alipaydev.com/gateway.do'),
          notifyUrl: credentials.ALIPAY_NOTIFY_URL ?? '',
          returnUrl: credentials.ALIPAY_RETURN_URL ?? '',
        },
        deps
      )
    case 'wechat':
      return new WeChatPayProvider(
        {
          appId: credentials.WECHAT_APP_ID as string,
          mchId: credentials.WECHAT_MCH_ID as string,
          apiKey: credentials.WECHAT_API_KEY as string,
          privateKey: credentials.WECHAT_PRIVATE_KEY as string,
          certificatePath: credentials.WECHAT_CERTIFICATE_PATH ?? '',
          notifyUrl: credentials.WECHAT_NOTIFY_URL ?? '',
          returnUrl: credentials.WECHAT_RETURN_URL ?? '',
        },
        deps
      )
    default:
      throw new Error(`Unsupported payment provider: ${provider}`)
  }
}
