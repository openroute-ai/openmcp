import * as AlipayUtils from '../utils/alipay-utils'
import { normalizePem } from '../utils/pem'
import type {
  AlipayTopUpCredentials,
  CreateTopUpParams,
  TopUpGateway,
  TopUpSession,
  VerifyTopUpCallbackResult,
} from './types'

const SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Alipay face-to-face / precreate top-up gateway.
 *
 * Uses `alipay.trade.precreate` for a QR payload and RSA2 verification on the
 * async notify body. Settlement stays in the host.
 */
export class AlipayTopUpGateway implements TopUpGateway {
  readonly channel = 'alipay' as const
  private readonly creds: AlipayTopUpCredentials

  constructor(credentials: AlipayTopUpCredentials) {
    const missing = (
      [
        ['appId', credentials.appId],
        ['privateKey', credentials.privateKey],
        ['publicKey', credentials.publicKey],
        ['gateway', credentials.gateway],
        ['notifyUrl', credentials.notifyUrl],
      ] as const
    ).filter(([, v]) => !v?.trim())
    if (missing.length > 0) {
      throw new Error(
        `AlipayTopUpGateway missing credentials: ${missing.map(([k]) => k).join(', ')}`
      )
    }
    this.creds = {
      ...credentials,
      privateKey: normalizePem(credentials.privateKey, 'PRIVATE KEY'),
      publicKey: normalizePem(credentials.publicKey, 'PUBLIC KEY'),
    }
  }

  async createTopUp(params: CreateTopUpParams): Promise<TopUpSession> {
    const bizContent = JSON.stringify({
      out_trade_no: params.orderId,
      total_amount: Number(params.amount).toFixed(2),
      subject: params.subject.slice(0, 256),
      // FACE_TO_FACE_PAYMENT is the product code for 当面付 / precreate QR.
      product_code: 'FACE_TO_FACE_PAYMENT',
    })

    const requestParams: Record<string, string> = {
      app_id: this.creds.appId,
      method: 'alipay.trade.precreate',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: formatAlipayTimestamp(new Date()),
      version: '1.0',
      notify_url: this.creds.notifyUrl,
      biz_content: bizContent,
    }

    requestParams.sign = AlipayUtils.generateSignature(requestParams, this.creds.privateKey)

    const body = AlipayUtils.objectToQueryString(requestParams)
    const response = await fetch(this.creds.gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        Accept: 'application/json',
      },
      body,
    })

    const text = await response.text()
    let parsed: {
      alipay_trade_precreate_response?: {
        code?: string
        msg?: string
        sub_msg?: string
        out_trade_no?: string
        qr_code?: string
      }
      sign?: string
    }
    try {
      parsed = JSON.parse(text) as typeof parsed
    } catch {
      throw new Error(`Alipay precreate returned non-JSON (${response.status}): ${text.slice(0, 200)}`)
    }

    const result = parsed.alipay_trade_precreate_response
    if (!result || result.code !== '10000' || !result.qr_code) {
      throw new Error(
        `Alipay precreate failed: ${result?.sub_msg ?? result?.msg ?? result?.code ?? text.slice(0, 200)}`
      )
    }

    return {
      orderId: params.orderId,
      channel: 'alipay',
      redirectUrl: null,
      qrPayload: result.qr_code,
      returnUrl: `${params.origin}/settings/recharge?orderId=${params.orderId}`,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }
  }

  /**
   * Verify an Alipay async notify.
   *
   * Expects `application/x-www-form-urlencoded` body. `signature` may be empty;
   * the `sign` field inside the body is used when present.
   */
  async verifyCallback(
    payload: string,
    signature: string,
    _headers?: Headers
  ): Promise<VerifyTopUpCallbackResult> {
    if (!payload?.trim()) {
      return { ok: false, error: 'Empty Alipay notification body' }
    }

    const fields = AlipayUtils.queryStringToObject(payload)
    const sign = (signature || fields.sign || '').toString()
    if (!sign) {
      return { ok: false, error: 'Missing Alipay sign field' }
    }

    const valid = AlipayUtils.verifySignature(fields, sign, this.creds.publicKey)
    if (!valid) {
      return { ok: false, error: 'Invalid Alipay notification signature' }
    }

    const tradeStatus = String(fields.trade_status ?? '')
    if (tradeStatus && tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      return {
        ok: false,
        error: `Alipay trade_status is ${tradeStatus}, not a success state`,
      }
    }

    const orderId = String(fields.out_trade_no ?? '')
    const amount = String(fields.total_amount ?? '')
    if (!orderId || !amount) {
      return { ok: false, error: 'Alipay notification missing out_trade_no or total_amount' }
    }

    return {
      ok: true,
      callback: {
        orderId,
        amount: Number(amount).toFixed(2),
        channel: 'alipay',
        transactionId: fields.trade_no ? String(fields.trade_no) : undefined,
        raw: fields,
      },
    }
  }
}

/** Alipay expects `yyyy-MM-dd HH:mm:ss` in Asia/Shanghai. */
function formatAlipayTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}
