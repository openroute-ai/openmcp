import { createDecipheriv, createSign, createVerify, randomBytes } from 'node:crypto'
import { normalizePem } from './pem'

/**
 * WeChat Pay API v3 helpers for Native top-up (扫码支付).
 *
 * Separate from the legacy v2 MD5/XML helpers in `wechat-utils.ts`: top-up
 * callbacks use JSON + RSA-SHA256 headers + AES-256-GCM resource encryption.
 */

export function majorToFen(amount: string): number {
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid WeChat amount: ${amount}`)
  }
  return Math.round(n * 100)
}

export function fenToMajor(fen: number): string {
  return (fen / 100).toFixed(2)
}

/** Build the Authorization value for an outbound API v3 request. */
export function buildAuthorization(params: {
  mchId: string
  serialNo: string
  privateKey: string
  method: string
  /** Path + query, e.g. `/v3/pay/transactions/native` */
  urlPath: string
  body: string
  timestamp?: string
  nonce?: string
}): { authorization: string; timestamp: string; nonce: string } {
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000).toString()
  const nonce = params.nonce ?? randomBytes(16).toString('hex')
  const message = `${params.method}\n${params.urlPath}\n${timestamp}\n${nonce}\n${params.body}\n`
  const key = normalizePem(params.privateKey, 'PRIVATE KEY')
  const signature = createSign('RSA-SHA256').update(message).sign(key, 'base64')
  const authorization =
    `WECHATPAY2-SHA256-RSA2048 mchid="${params.mchId}",` +
    `nonce_str="${nonce}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${params.serialNo}"`
  return { authorization, timestamp, nonce }
}

/**
 * Verify the `Wechatpay-Signature` header on a notification.
 *
 * Message format: `${timestamp}\n${nonce}\n${body}\n`
 */
export function verifyNotificationSignature(params: {
  timestamp: string
  nonce: string
  body: string
  signature: string
  platformPublicKey: string
}): boolean {
  try {
    const message = `${params.timestamp}\n${params.nonce}\n${params.body}\n`
    const raw = params.platformPublicKey.trim().replace(/\\n/g, '\n')
    // Accept either a bare/SPKI public key or a full platform certificate PEM.
    const key = raw.includes('CERTIFICATE')
      ? normalizePem(raw, 'CERTIFICATE')
      : normalizePem(raw, 'PUBLIC KEY')
    return createVerify('RSA-SHA256').update(message).verify(key, params.signature, 'base64')
  } catch (error) {
    console.error('[wechat-v3] signature verification error', error)
    return false
  }
}

/**
 * Decrypt an `encrypt-resource` notification with the APIv3 key (AES-256-GCM).
 * Ciphertext is base64; the last 16 bytes are the auth tag.
 */
export function decryptResource(params: {
  apiV3Key: string
  ciphertext: string
  nonce: string
  associatedData: string
}): string {
  const key = Buffer.from(params.apiV3Key, 'utf8')
  if (key.length !== 32) {
    throw new Error('WECHAT_API_V3_KEY must be exactly 32 bytes')
  }
  const buf = Buffer.from(params.ciphertext, 'base64')
  if (buf.length <= 16) {
    throw new Error('WeChat ciphertext is too short')
  }
  const data = buf.subarray(0, buf.length - 16)
  const authTag = buf.subarray(buf.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(params.nonce, 'utf8'))
  decipher.setAuthTag(authTag)
  if (params.associatedData) {
    decipher.setAAD(Buffer.from(params.associatedData, 'utf8'))
  }
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export interface WeChatV3Transaction {
  out_trade_no?: string
  transaction_id?: string
  trade_state?: string
  amount?: { total?: number; currency?: string }
  [key: string]: unknown
}

export interface WeChatV3Notification {
  id?: string
  event_type?: string
  resource_type?: string
  resource?: {
    algorithm?: string
    ciphertext?: string
    associated_data?: string
    nonce?: string
    original_type?: string
  }
  [key: string]: unknown
}
