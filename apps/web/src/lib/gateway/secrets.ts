import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'

function getSecret(): Buffer {
  const secret = process.env.GATEWAY_SECRET_KEY || process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error('GATEWAY_SECRET_KEY or BETTER_AUTH_SECRET is required to encrypt gateway credentials')
  }
  return scryptSync(secret, 'openmcp-gateway-auth', 32)
}

export function encryptSecret(plain: string): string {
  const key = getSecret()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted secret payload')
  }
  const key = getSecret()
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return decrypted.toString('utf8')
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}****${value.slice(-2)}`
}
