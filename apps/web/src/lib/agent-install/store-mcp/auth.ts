import { createHash } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { apiKeys, oauthTokens } from '@workspace/db'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { GATEWAY_KEY_HEADER } from '@/lib/agent-install/urls'

export type StoreAuthMethod = 'session' | 'api_key' | 'oauth' | null

export type StoreAuthResult = {
  userId: string | null
  method: StoreAuthMethod
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function extractBearer(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) return token
  }
  const gatewayKey = request.headers.get(GATEWAY_KEY_HEADER)?.trim()
  if (gatewayKey) return gatewayKey
  return null
}

async function resolveApiKey(rawKey: string): Promise<string | null> {
  const hashed = hashToken(rawKey)
  const [row] = await db
    .select({
      userId: apiKeys.userId,
      enabled: apiKeys.enabled,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.key, hashed))
    .limit(1)

  if (!row || !row.enabled) return null
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null
  return row.userId
}

async function resolveOAuthToken(rawToken: string): Promise<string | null> {
  const hashed = hashToken(rawToken)
  const [row] = await db
    .select({
      userId: oauthTokens.userId,
      expiresAt: oauthTokens.expiresAt,
    })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, hashed), gt(oauthTokens.expiresAt, new Date())))
    .limit(1)

  return row?.userId ?? null
}

/**
 * Resolve caller identity for Store MCP / skill package routes.
 * Order: session cookie → Bearer / x-litellm-api-key (API Key or OAuth opaque token).
 */
export async function resolveStoreAuth(request: Request): Promise<StoreAuthResult> {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (session?.user?.id) {
      return { userId: session.user.id, method: 'session' }
    }
  } catch {
    // ignore session parse errors; fall through to bearer
  }

  const raw = extractBearer(request)
  if (!raw) return { userId: null, method: null }

  // OAuth opaque tokens use the `omt_` prefix; everything else is treated as an API key.
  if (raw.startsWith('omt_')) {
    const userId = await resolveOAuthToken(raw)
    return { userId, method: userId ? 'oauth' : null }
  }

  const userId = await resolveApiKey(raw)
  if (userId) return { userId, method: 'api_key' }

  // Fallback: allow omt-less oauth tokens (legacy / pasted hashes) via oauth table
  const oauthUserId = await resolveOAuthToken(raw)
  if (oauthUserId) return { userId: oauthUserId, method: 'oauth' }

  return { userId: null, method: null }
}

export { hashToken, extractBearer }
