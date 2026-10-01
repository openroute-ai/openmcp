import { a2aAgents } from '@workspace/db'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getA2aGateway, isLiteLLMConfigured } from '@workspace/litellm'
import { decryptSecret } from '@/lib/gateway/secrets'
import { db } from '@/lib/db'

/**
 * OAuth callback for A2A assets held on our behalf.
 *
 * GET /api/oauth/callback/a2a
 *
 * Receives the upstream authorization callback, exchanges the code for a token,
 * stores the token on the LiteLLM agent and records `oauthStatus` in OpenMCP.
 * The `redirect_uri` is handed to the upstream provider by
 * `web/a2a-agents/router.ts` (`startOAuth`), so this route must exist for that
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
    const returnPath = '/dashboard/assets/a2a'
    const back = (query: string) =>
      NextResponse.redirect(new URL(`${returnPath}?${query}`, request.url))

    if (error) {
      console.error('[oauth-callback-a2a] Authorization error:', error, errorDescription)
      return back(`oauth_error=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
    }

    // `state` is base64url JSON written by `startOAuth`.
    let stateData: { agentName: string; authorId: string }
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
    } catch {
      return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
    }

    const [asset] = await db
      .select()
      .from(a2aAgents)
      .where(eq(a2aAgents.agentName, stateData.agentName))
      .limit(1)

    if (!asset) {
      console.error('[oauth-callback-a2a] Asset not found:', stateData.agentName)
      return back('oauth_error=asset_not_found')
    }

    const authConfig = (asset.authConfig as Record<string, unknown>) || {}
    const clientId = authConfig.clientId as string | undefined
    const encryptedClientSecret = authConfig.encrypted_client_secret as string | undefined
    const tokenUrl = authConfig.tokenUrl as string | undefined

    if (!clientId || !encryptedClientSecret || !tokenUrl) {
      console.error('[oauth-callback-a2a] Missing OAuth config:', {
        clientId: !!clientId,
        tokenUrl: !!tokenUrl,
      })
      return back('oauth_error=invalid_config')
    }

    let clientSecret: string
    try {
      clientSecret = decryptSecret(encryptedClientSecret)
    } catch (err) {
      console.error('[oauth-callback-a2a] Failed to decrypt client_secret:', err)
      return back('oauth_error=decrypt_failed')
    }

    // Step 1: exchange the authorization code at the upstream token endpoint.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:30021'
    const redirectUri = `${baseUrl}/api/oauth/callback/a2a`

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
        console.error('[oauth-callback-a2a] Token exchange failed:', tokenResponse)
        return back(`oauth_error=${encodeURIComponent(tokenResponse.error || 'token_exchange_failed')}`)
      }
    } catch (err) {
      console.error('[oauth-callback-a2a] Token exchange request failed:', err)
      return back('oauth_error=token_request_failed')
    }

    // Step 2: push the token to LiteLLM as a static header on the agent.
    if (isLiteLLMConfigured() && asset.litellmAgentId) {
      try {
        const gateway = getA2aGateway()
        const tokenType = tokenResponse.token_type || 'Bearer'
        await gateway.updateAgent(asset.litellmAgentId, {
          static_headers: {
            Authorization: `${tokenType} ${tokenResponse.access_token}`,
          },
        })
        console.log('[oauth-callback-a2a] Updated LiteLLM agent with access_token:', asset.litellmAgentId)
      } catch (err) {
        console.error('[oauth-callback-a2a] Failed to update LiteLLM agent:', err)
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
      .update(a2aAgents)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(a2aAgents.id, asset.id))

    console.log('[oauth-callback-a2a] OAuth flow completed successfully for:', stateData.agentName)

    return back(`oauth_success=1&asset_id=${asset.id}`)
  } catch (error) {
    console.error('[oauth-callback-a2a] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
