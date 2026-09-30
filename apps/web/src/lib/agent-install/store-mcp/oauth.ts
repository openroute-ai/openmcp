import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthDeviceCodes,
  oauthTokens,
} from '@workspace/db'
import { db } from '@/lib/db'
import { getAppBaseUrl } from '@/lib/agent-install/urls'
import { hashToken } from './auth'

export const STORE_OAUTH_CLIENT_ID = 'openmcp-store'
export const DEFAULT_SCOPE = 'skills:read skills:install'
export const DEVICE_CODE_TTL_SEC = 600
export const ACCESS_TOKEN_TTL_SEC = 60 * 60 * 24 * 30 // 30 days
export const POLL_INTERVAL_SEC = 5
export const AUTH_CODE_TTL_SEC = 600

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomUserCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length]
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

function randomOpaque(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`
}

/** Ensure the default public client exists (idempotent). */
export async function ensureStoreOauthClient(): Promise<void> {
  const [existing] = await db
    .select({ id: oauthClients.id })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, STORE_OAUTH_CLIENT_ID))
    .limit(1)
  if (existing) return

  await db.insert(oauthClients).values({
    clientId: STORE_OAUTH_CLIENT_ID,
    clientName: 'OpenMCP Store MCP',
    clientType: 'public',
    redirectUris: [
      'cursor://oauth-callback',
      'claude://oauth-callback',
      'http://localhost:3000/oauth/callback',
    ],
    grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'authorization_code'],
    scope: DEFAULT_SCOPE,
  })
}

export async function createDeviceCode(params?: {
  clientId?: string
  scope?: string
}): Promise<{
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}> {
  await ensureStoreOauthClient()

  const clientId = params?.clientId || STORE_OAUTH_CLIENT_ID
  const scope = params?.scope || DEFAULT_SCOPE
  const rawDeviceCode = randomOpaque('odc_', 32)
  const deviceCodeHash = hashToken(rawDeviceCode)
  const userCode = randomUserCode()
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SEC * 1000)
  const base = getAppBaseUrl()

  await db.insert(oauthDeviceCodes).values({
    deviceCode: deviceCodeHash,
    userCode,
    clientId,
    scope,
    status: 'pending',
    expiresAt,
  })

  return {
    device_code: rawDeviceCode,
    user_code: userCode,
    verification_uri: `${base}/device`,
    verification_uri_complete: `${base}/device?user_code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_CODE_TTL_SEC,
    interval: POLL_INTERVAL_SEC,
  }
}

export type DeviceAuthorizeResult =
  | { ok: true }
  | { ok: false; error: string; status: number }

export async function authorizeDeviceCode(params: {
  userCode: string
  userId: string
  action: 'authorize' | 'deny'
}): Promise<DeviceAuthorizeResult> {
  const normalized = params.userCode.trim().toUpperCase()
  const [row] = await db
    .select()
    .from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.userCode, normalized))
    .limit(1)

  if (!row) return { ok: false, error: '授权码无效', status: 404 }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: '授权码已过期', status: 400 }
  }
  if (row.status !== 'pending') {
    return { ok: false, error: '授权码已处理', status: 400 }
  }

  await db
    .update(oauthDeviceCodes)
    .set({
      status: params.action === 'authorize' ? 'authorized' : 'denied',
      userId: params.action === 'authorize' ? params.userId : null,
    })
    .where(eq(oauthDeviceCodes.id, row.id))

  return { ok: true }
}

export type TokenGrantResult =
  | {
      ok: true
      access_token: string
      token_type: 'Bearer'
      expires_in: number
      scope: string
    }
  | { ok: false; error: string; error_description?: string; status: number }

export async function exchangeDeviceCode(params: {
  deviceCode: string
  clientId?: string
}): Promise<TokenGrantResult> {
  const deviceCodeHash = hashToken(params.deviceCode)
  const [row] = await db
    .select()
    .from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.deviceCode, deviceCodeHash))
    .limit(1)

  if (!row) {
    return {
      ok: false,
      error: 'invalid_grant',
      error_description: 'device_code 无效',
      status: 400,
    }
  }

  if (params.clientId && row.clientId !== params.clientId) {
    return {
      ok: false,
      error: 'invalid_client',
      error_description: 'client_id 不匹配',
      status: 400,
    }
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'expired_token', error_description: 'device_code 已过期', status: 400 }
  }

  if (row.status === 'pending') {
    return {
      ok: false,
      error: 'authorization_pending',
      error_description: '等待用户授权',
      status: 400,
    }
  }

  if (row.status === 'denied') {
    return { ok: false, error: 'access_denied', error_description: '用户拒绝授权', status: 400 }
  }

  if (!row.userId) {
    return { ok: false, error: 'invalid_grant', error_description: '未绑定用户', status: 400 }
  }

  const accessToken = randomOpaque('omt_', 32)
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000)
  const scope = row.scope || DEFAULT_SCOPE

  await db.insert(oauthTokens).values({
    tokenHash: hashToken(accessToken),
    userId: row.userId,
    clientId: row.clientId,
    scope,
    expiresAt,
  })

  // One-time use: clear device code after successful exchange
  await db.delete(oauthDeviceCodes).where(eq(oauthDeviceCodes.id, row.id))

  return {
    ok: true,
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope,
  }
}

export async function createAuthorizationCode(params: {
  clientId: string
  redirectUri: string
  userId: string
  scope?: string
  state?: string | null
  codeChallenge?: string | null
  codeChallengeMethod?: string | null
}): Promise<{ code: string } | { error: string }> {
  await ensureStoreOauthClient()

  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, params.clientId))
    .limit(1)

  if (!client) return { error: '未知 client_id' }
  if (!client.redirectUris.includes(params.redirectUri)) {
    return { error: 'redirect_uri 未注册' }
  }

  const code = randomOpaque('oac_', 24)
  await db.insert(oauthAuthorizationCodes).values({
    code: hashToken(code),
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scope: params.scope || DEFAULT_SCOPE,
    state: params.state ?? null,
    userId: params.userId,
    codeChallenge: params.codeChallenge ?? null,
    codeChallengeMethod: params.codeChallengeMethod ?? null,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000),
    used: false,
  })

  return { code }
}

function verifyPkce(
  verifier: string | undefined,
  challenge: string | null,
  method: string | null
): boolean {
  if (!challenge) return true
  if (!verifier) return false
  if ((method || 'S256') === 'S256') {
    const computed = createHash('sha256').update(verifier).digest('base64url')
    return computed === challenge
  }
  if (method === 'plain') return verifier === challenge
  return false
}

export async function exchangeAuthorizationCode(params: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier?: string
}): Promise<TokenGrantResult> {
  const codeHash = hashToken(params.code)
  const [row] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.code, codeHash))
    .limit(1)

  if (!row || row.used) {
    return { ok: false, error: 'invalid_grant', error_description: 'authorization_code 无效', status: 400 }
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'invalid_grant', error_description: 'authorization_code 已过期', status: 400 }
  }
  if (row.clientId !== params.clientId || row.redirectUri !== params.redirectUri) {
    return { ok: false, error: 'invalid_grant', error_description: 'client/redirect 不匹配', status: 400 }
  }
  if (!verifyPkce(params.codeVerifier, row.codeChallenge, row.codeChallengeMethod)) {
    return { ok: false, error: 'invalid_grant', error_description: 'PKCE 校验失败', status: 400 }
  }

  await db
    .update(oauthAuthorizationCodes)
    .set({ used: true })
    .where(eq(oauthAuthorizationCodes.id, row.id))

  const accessToken = randomOpaque('omt_', 32)
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000)
  const scope = row.scope || DEFAULT_SCOPE

  await db.insert(oauthTokens).values({
    tokenHash: hashToken(accessToken),
    userId: row.userId,
    clientId: row.clientId,
    scope,
    expiresAt,
  })

  return {
    ok: true,
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope,
  }
}
