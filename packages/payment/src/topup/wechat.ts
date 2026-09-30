import type {
  CreateTopUpParams,
  TopUpGateway,
  TopUpSession,
  VerifyTopUpCallbackResult,
  WeChatTopUpCredentials,
} from './types'
import {
  buildAuthorization,
  decryptResource,
  fenToMajor,
  majorToFen,
  verifyNotificationSignature,
  type WeChatV3Notification,
  type WeChatV3Transaction,
} from '../utils/wechat-v3'

const NATIVE_PATH = '/v3/pay/transactions/native'
const API_HOST = 'https://api.mch.weixin.qq.com'
const SESSION_TTL_MS = 30 * 60 * 1000

/**
 * WeChat Pay Native (API v3) top-up gateway.
 *
 * Creates a QR code via `/v3/pay/transactions/native` and verifies encrypted
 * payment notifications. Credits are never applied here — the host calls
 * `settleRechargeOrder` after a successful `verifyCallback`.
 */
export class WeChatTopUpGateway implements TopUpGateway {
  readonly channel = 'wechat' as const
  private readonly creds: WeChatTopUpCredentials

  constructor(credentials: WeChatTopUpCredentials) {
    const missing = (
      [
        ['appId', credentials.appId],
        ['mchId', credentials.mchId],
        ['apiV3Key', credentials.apiV3Key],
        ['mchCertSerial', credentials.mchCertSerial],
        ['privateKey', credentials.privateKey],
        ['platformPublicKey', credentials.platformPublicKey],
        ['notifyUrl', credentials.notifyUrl],
      ] as const
    ).filter(([, v]) => !v?.trim())
    if (missing.length > 0) {
      throw new Error(
        `WeChatTopUpGateway missing credentials: ${missing.map(([k]) => k).join(', ')}`
      )
    }
    this.creds = credentials
  }

  async createTopUp(params: CreateTopUpParams): Promise<TopUpSession> {
    const total = majorToFen(params.amount)
    const bodyObj = {
      appid: this.creds.appId,
      mchid: this.creds.mchId,
      description: params.subject.slice(0, 127),
      out_trade_no: params.orderId,
      notify_url: this.creds.notifyUrl,
      amount: {
        total,
        currency: (params.currency || 'CNY').toUpperCase(),
      },
    }
    const body = JSON.stringify(bodyObj)
    const { authorization } = buildAuthorization({
      mchId: this.creds.mchId,
      serialNo: this.creds.mchCertSerial,
      privateKey: this.creds.privateKey,
      method: 'POST',
      urlPath: NATIVE_PATH,
      body,
    })

    const response = await fetch(`${API_HOST}${NATIVE_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'openmcp-payment/topup',
      },
      body,
    })

    const text = await response.text()
    let parsed: { code_url?: string; code?: string; message?: string }
    try {
      parsed = JSON.parse(text) as typeof parsed
    } catch {
      throw new Error(`WeChat native order returned non-JSON (${response.status}): ${text.slice(0, 200)}`)
    }

    if (!response.ok || !parsed.code_url) {
      throw new Error(
        `WeChat native order failed (${response.status}): ${parsed.message ?? parsed.code ?? text.slice(0, 200)}`
      )
    }

    return {
      orderId: params.orderId,
      channel: 'wechat',
      redirectUrl: null,
      qrPayload: parsed.code_url,
      returnUrl: `${params.origin}/settings/recharge?orderId=${params.orderId}`,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }
  }

  /**
   * Verify a WeChat Pay v3 notification.
   *
   * `signature` is the `Wechatpay-Signature` header. Timestamp / nonce come from
   * `headers`. A non-SUCCESS trade state returns `ok: false` with a stable error
   * so the route can ACK without crediting.
   */
  async verifyCallback(
    payload: string,
    signature: string,
    headers?: Headers
  ): Promise<VerifyTopUpCallbackResult> {
    if (!payload?.trim()) {
      return { ok: false, error: 'Empty WeChat notification body' }
    }
    if (!signature) {
      return { ok: false, error: 'Missing Wechatpay-Signature header' }
    }

    const timestamp = headers?.get('Wechatpay-Timestamp') ?? headers?.get('wechatpay-timestamp') ?? ''
    const nonce = headers?.get('Wechatpay-Nonce') ?? headers?.get('wechatpay-nonce') ?? ''
    if (!timestamp || !nonce) {
      return { ok: false, error: 'Missing Wechatpay-Timestamp or Wechatpay-Nonce' }
    }

    const signed = verifyNotificationSignature({
      timestamp,
      nonce,
      body: payload,
      signature,
      platformPublicKey: this.creds.platformPublicKey,
    })
    if (!signed) {
      return { ok: false, error: 'Invalid WeChat notification signature' }
    }

    let notification: WeChatV3Notification
    try {
      notification = JSON.parse(payload) as WeChatV3Notification
    } catch {
      return { ok: false, error: 'WeChat notification body is not valid JSON' }
    }

    const resource = notification.resource
    if (!resource?.ciphertext || !resource.nonce) {
      return { ok: false, error: 'WeChat notification is missing encrypted resource' }
    }

    let transaction: WeChatV3Transaction
    try {
      const plain = decryptResource({
        apiV3Key: this.creds.apiV3Key,
        ciphertext: resource.ciphertext,
        nonce: resource.nonce,
        associatedData: resource.associated_data ?? '',
      })
      transaction = JSON.parse(plain) as WeChatV3Transaction
    } catch (error) {
      console.error('[wechat-topup] resource decrypt failed', error)
      return { ok: false, error: 'Failed to decrypt WeChat notification resource' }
    }

    if (transaction.trade_state && transaction.trade_state !== 'SUCCESS') {
      return {
        ok: false,
        error: `WeChat trade_state is ${transaction.trade_state}, not SUCCESS`,
      }
    }

    const orderId = transaction.out_trade_no
    const totalFen = transaction.amount?.total
    if (!orderId || totalFen === undefined || totalFen === null) {
      return { ok: false, error: 'WeChat notification missing out_trade_no or amount.total' }
    }

    return {
      ok: true,
      callback: {
        orderId,
        amount: fenToMajor(Number(totalFen)),
        channel: 'wechat',
        transactionId: transaction.transaction_id,
        raw: { notification, transaction },
      },
    }
  }
}
