import { NextResponse } from 'next/server'
import {
  exchangeAuthorizationCode,
  exchangeDeviceCode,
  STORE_OAUTH_CLIENT_ID,
} from '@/lib/agent-install/store-mcp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/**
 * POST /api/mcp/store/oauth/token
 * Supports device_code and authorization_code grants.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let body: Record<string, string> = {}

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData()
      form.forEach((v, k) => {
        body[k] = String(v)
      })
    } else {
      body = (await request.json()) as Record<string, string>
    }

    const grantType = body.grant_type
    const clientId = body.client_id || STORE_OAUTH_CLIENT_ID

    if (grantType === DEVICE_GRANT) {
      if (!body.device_code) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: '缺少 device_code' },
          { status: 400 }
        )
      }
      const result = await exchangeDeviceCode({
        deviceCode: body.device_code,
        clientId,
      })
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, error_description: result.error_description },
          { status: result.status }
        )
      }
      return NextResponse.json({
        access_token: result.access_token,
        token_type: result.token_type,
        expires_in: result.expires_in,
        scope: result.scope,
      })
    }

    if (grantType === 'authorization_code') {
      if (!body.code || !body.redirect_uri) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: '缺少 code 或 redirect_uri' },
          { status: 400 }
        )
      }
      const result = await exchangeAuthorizationCode({
        code: body.code,
        clientId,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier,
      })
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, error_description: result.error_description },
          { status: result.status }
        )
      }
      return NextResponse.json({
        access_token: result.access_token,
        token_type: result.token_type,
        expires_in: result.expires_in,
        scope: result.scope,
      })
    }

    return NextResponse.json(
      {
        error: 'unsupported_grant_type',
        error_description: `支持 ${DEVICE_GRANT} 与 authorization_code`,
      },
      { status: 400 }
    )
  } catch (error) {
    console.error('[oauth/token]', error)
    return NextResponse.json({ error: 'server_error', error_description: '换取令牌失败' }, { status: 500 })
  }
}
