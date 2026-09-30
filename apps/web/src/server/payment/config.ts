import type { AlipayTopUpCredentials, WeChatTopUpCredentials } from '@workspace/payment/topup'
import {
  ALIPAY_TOPUP_REQUIRED_KEYS,
  WECHAT_TOPUP_REQUIRED_KEYS,
} from '@workspace/payment/topup'
import { websiteConfig } from '@/lib/config/website'

/**
 * Resolve production top-up credentials from the environment.
 *
 * The payment package never reads `process.env` itself — the host assembles
 * these objects and injects them into the gateway constructors.
 */

const env = (key: string): string | undefined => {
  const v = process.env[key]
  return v && v.trim() ? v.trim() : undefined
}

const publicOrigin = (): string =>
  (websiteConfig.metadata.base_url || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '')

export function missingWeChatTopUpKeys(): string[] {
  return WECHAT_TOPUP_REQUIRED_KEYS.filter((key) => {
    if (key === 'WECHAT_NOTIFY_URL') {
      // Derived from the public origin when unset.
      return !env('WECHAT_NOTIFY_URL') && !publicOrigin()
    }
    return !env(key)
  })
}

export function missingAlipayTopUpKeys(): string[] {
  return ALIPAY_TOPUP_REQUIRED_KEYS.filter((key) => {
    if (key === 'ALIPAY_NOTIFY_URL') {
      return !env('ALIPAY_NOTIFY_URL') && !publicOrigin()
    }
    return !env(key)
  })
}

export function resolveWeChatTopUpCredentials(): WeChatTopUpCredentials | null {
  if (missingWeChatTopUpKeys().length > 0) return null
  const origin = publicOrigin()
  return {
    appId: env('WECHAT_APP_ID')!,
    mchId: env('WECHAT_MCH_ID')!,
    apiV3Key: env('WECHAT_API_V3_KEY')!,
    mchCertSerial: env('WECHAT_MCH_CERT_SERIAL')!,
    privateKey: env('WECHAT_PRIVATE_KEY')!,
    platformPublicKey: env('WECHAT_PLATFORM_PUBLIC_KEY')!,
    notifyUrl: env('WECHAT_NOTIFY_URL') ?? `${origin}/api/webhook/wechat`,
  }
}

export function resolveAlipayTopUpCredentials(): AlipayTopUpCredentials | null {
  if (missingAlipayTopUpKeys().length > 0) return null
  const origin = publicOrigin()
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    appId: env('ALIPAY_APP_ID')!,
    privateKey: env('ALIPAY_PRIVATE_KEY')!,
    publicKey: env('ALIPAY_PUBLIC_KEY')!,
    gateway:
      env('ALIPAY_GATEWAY') ??
      (isProduction
        ? 'https://openapi.alipay.com/gateway.do'
        : 'https://openapi.alipaydev.com/gateway.do'),
    notifyUrl: env('ALIPAY_NOTIFY_URL') ?? `${origin}/api/webhook/alipay`,
  }
}
