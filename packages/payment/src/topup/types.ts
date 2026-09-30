/**
 * Wallet top-up gateway.
 *
 * `PaymentProvider.createCheckout` is shaped around subscriptions: it needs a
 * plan, a price id and a customer email. A wallet top-up has none of those — it
 * is a one-off amount against a merchant account — so it gets its own small
 * interface instead of being forced through the catalog API.
 *
 * The interface is deliberately narrow. A gateway creates a payable session and
 * verifies a callback; it never credits a wallet. Money movement lives in the
 * host's settlement service so that the webhook and the admin bank-transfer
 * reconciliation share one audited code path.
 */

export type TopUpChannel = 'wechat' | 'alipay'

export interface CreateTopUpParams {
  /** Merchant-side order id; the gateway echoes it back on the callback. */
  orderId: string
  /** Major-unit amount, e.g. "88.00". */
  amount: string
  currency: string
  subject: string
  /** Public origin used to build return URLs. */
  origin: string
  /** Locale hint for gateway-hosted content. */
  locale?: string
}

export interface TopUpSession {
  orderId: string
  channel: TopUpChannel
  /** Where the payer is sent, or null for a QR-only flow. */
  redirectUrl?: string | null
  /**
   * Payload to render as a QR code. For WeChat this is the `code_url`; for
   * Alipay it is the `qr_code` string from `alipay.trade.precreate`.
   */
  qrPayload?: string | null
  /** Absolute path the user returns to after paying. */
  returnUrl?: string
  expiresAt: Date
}

export interface TopUpCallback {
  orderId: string
  /** Major-unit amount the gateway reports; verified against the order. */
  amount: string
  channel: TopUpChannel
  transactionId?: string
  raw?: Record<string, unknown>
}

export type VerifyTopUpCallbackResult =
  | { ok: true; callback: TopUpCallback }
  | { ok: false; error: string }

export interface TopUpGateway {
  readonly channel: TopUpChannel
  createTopUp(params: CreateTopUpParams): Promise<TopUpSession>
  /**
   * Verifies the gateway signature and normalises the payload.
   *
   * Must throw (or return `ok: false`) for an unsigned or tampered callback;
   * the caller treats that as "do not credit".
   */
  verifyCallback(payload: string, signature: string, headers?: Headers): Promise<VerifyTopUpCallbackResult>
}

/**
 * Credentials for the WeChat Pay Native (API v3) top-up adapter.
 * Injected by the host; this package never reads `process.env`.
 */
export interface WeChatTopUpCredentials {
  appId: string
  mchId: string
  /** APIv3 key (32 bytes) used to decrypt notification resources. */
  apiV3Key: string
  /** Merchant certificate serial used in the Authorization header. */
  mchCertSerial: string
  /** Merchant RSA private key (PEM). */
  privateKey: string
  /**
   * WeChat Pay platform public key (PEM) used to verify
   * `Wechatpay-Signature` on callbacks. Obtain from the merchant console
   * ("微信支付公钥") or from a downloaded platform certificate.
   */
  platformPublicKey: string
  notifyUrl: string
}

/**
 * Credentials for the Alipay face-to-face / precreate top-up adapter.
 */
export interface AlipayTopUpCredentials {
  appId: string
  privateKey: string
  /** Alipay platform public key (RSA2) for verifying async notifies. */
  publicKey: string
  gateway: string
  notifyUrl: string
}

/** Keys a WeChat top-up gateway needs before it can be constructed. */
export const WECHAT_TOPUP_REQUIRED_KEYS = [
  'WECHAT_APP_ID',
  'WECHAT_MCH_ID',
  'WECHAT_API_V3_KEY',
  'WECHAT_MCH_CERT_SERIAL',
  'WECHAT_PRIVATE_KEY',
  'WECHAT_PLATFORM_PUBLIC_KEY',
  'WECHAT_NOTIFY_URL',
] as const

/** Keys an Alipay top-up gateway needs before it can be constructed. */
export const ALIPAY_TOPUP_REQUIRED_KEYS = [
  'ALIPAY_APP_ID',
  'ALIPAY_PRIVATE_KEY',
  'ALIPAY_PUBLIC_KEY',
  'ALIPAY_NOTIFY_URL',
] as const
