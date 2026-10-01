import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { mcpServers } from '@workspace/db'
import { getMcpGateway, isLiteLLMConfigured } from '@workspace/litellm'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/gateway/secrets'
import { verifyOAuthState } from '@/lib/agent-install/oauth-state'
import { notDeleted } from '@/web/assets/visibility'

/**
 * OAuth callback for MCP servers held on our behalf.
 *
 * GET /api/oauth/callback/mcp
 *
 * Receives the upstream authorization callback, exchanges the code for a token,
 * stores the token on the LiteLLM server and records `oauthStatus` in OpenMCP.
 * The `redirect_uri` is handed to the upstream provider by
 * `web/mcp-servers/router.ts` (`startOAuth`), so this route must exist for that
 * flow to complete.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Where the provider is sent back to — the author-facing asset list.
    const returnPath = '/dashboard/assets/mcp'
    const back = (query: string) =>
      NextResponse.redirect(new URL(`${returnPath}?${query}`, request.url))

    if (error) {
      console.error('[oauth-callback-mcp] Authorization error:', error, errorDescription)
      return back(`oauth_error=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
    }

    // `state` 由 `startOAuth` 用 HMAC 签发。签名不过 = 这个 state 不是我们
    // 签的：要么被改过，要么是攻击者自己构造的。之前这里是裸 base64url JSON，
    // 任何人都能手搓一个把授权结果写到别人资产上。
    const verified = verifyOAuthState(state)
    if (!verified.ok) {
      console.warn('[oauth-callback-mcp] rejected state:', verified.reason)
      return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
    }
    const stateData = {
      serverName: verified.payload.assetName,
      authorId: verified.payload.authorId,
    }

    // 签名只证明"这个 state 是我们签的"，不证明资产还在。所以仍要查库：
    // 软删除、归属不符、名字对不上都要在这里挡住，否则一个已删除的资产会被
    // 旧 state 写回，或把 A 的授权结果落到 B 的资产上。
    const [asset] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.serverName, stateData.serverName),
          notDeleted(mcpServers),
          eq(mcpServers.authorId, stateData.authorId)
        )
      )
      .limit(1)

    if (!asset) {
      console.error('[oauth-callback-mcp] Asset not found:', stateData.serverName)
      return back('oauth_error=asset_not_found')
    }

    const authConfig = (asset.authConfig as Record<string, unknown>) || {}
    const clientId = authConfig.clientId as string | undefined
    const encryptedClientSecret = authConfig.encrypted_client_secret as string | undefined
    const tokenUrl = authConfig.tokenUrl as string | undefined

    if (!clientId || !encryptedClientSecret || !tokenUrl) {
      console.error('[oauth-callback-mcp] Missing OAuth config:', {
        clientId: !!clientId,
        tokenUrl: !!tokenUrl,
      })
      return back('oauth_error=invalid_config')
    }

    let clientSecret: string
    try {
      clientSecret = decryptSecret(encryptedClientSecret)
    } catch (err) {
      console.error('[oauth-callback-mcp] Failed to decrypt client_secret:', err)
      return back('oauth_error=decrypt_failed')
    }

    // Step 1: exchange the authorization code at the upstream token endpoint.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:30021'
    const redirectUri = `${baseUrl}/api/oauth/callback/mcp`

    let tokenResponse: {
      access_token?: string
      refresh_token?: string
      token_type?: string
      error?: string
    }
    try {
      const tokenResp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })

      tokenResponse = await tokenResp.json()

      if (!tokenResp.ok || tokenResponse.error || !tokenResponse.access_token) {
        console.error('[oauth-callback-mcp] Token exchange failed:', tokenResponse)
        return back(`oauth_error=${encodeURIComponent(tokenResponse.error || 'token_exchange_failed')}`)
      }
    } catch (err) {
      console.error('[oauth-callback-mcp] Token exchange request failed:', err)
      return back('oauth_error=token_request_failed')
    }

    // Step 2: push the token to the LiteLLM server.
    if (isLiteLLMConfigured() && asset.litellmServerId) {
      try {
        const gateway = getMcpGateway()
        await gateway.updateServer({
          server_id: asset.litellmServerId,
          auth_value: tokenResponse.access_token,
        })
        console.log('[oauth-callback-mcp] Updated LiteLLM server with access_token:', asset.litellmServerId)
      } catch (err) {
        console.error('[oauth-callback-mcp] Failed to update LiteLLM server:', err)
        return back('oauth_error=litellm_update_failed')
      }
    }

    // Step 3: record the authorization in OpenMCP.
    const metadata = (asset.metadata as Record<string, unknown>) || {}
    metadata.oauthStatus = 'authorized'
    metadata.oauthAuthorizedAt = new Date().toISOString()
    metadata.oauthTokenType = tokenResponse.token_type || 'Bearer'
    if (tokenResponse.refresh_token) {
      // The refresh token itself is left to LiteLLM; we only note that we have one.
      metadata.oauthHasRefreshToken = true
    }

    await db
      .update(mcpServers)
      .set({ metadata, updatedAt: new Date() })
      .where(and(eq(mcpServers.id, asset.id), notDeleted(mcpServers)))

    console.log('[oauth-callback-mcp] OAuth flow completed successfully for:', stateData.serverName)

    return back(`oauth_success=1&asset_id=${asset.id}`)
  } catch (error) {
    console.error('[oauth-callback-mcp] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
