import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  authorizeDeviceCode,
  createAuthorizationCode,
  DEFAULT_SCOPE,
  STORE_OAUTH_CLIENT_ID,
} from '@/lib/agent-install/store-mcp'
import { getAppBaseUrl } from '@/lib/agent-install/urls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/mcp/store/oauth/authorize
 * Authorization Code Flow entry — redirects to login or /oauth/authorize confirm page.
 * (P2 / partial: works for registered redirect URIs; Device Code is the recommended P0 path.)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id') || STORE_OAUTH_CLIENT_ID
  const redirectUri = url.searchParams.get('redirect_uri')
  const scope = url.searchParams.get('scope') || DEFAULT_SCOPE
  const state = url.searchParams.get('state')
  const codeChallenge = url.searchParams.get('code_challenge')
  const codeChallengeMethod = url.searchParams.get('code_challenge_method')
  const responseType = url.searchParams.get('response_type') || 'code'

  if (responseType !== 'code' || !redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: '需要 response_type=code 与 redirect_uri' },
      { status: 400 }
    )
  }

  const session = await auth.api.getSession({ headers: request.headers })
  const base = getAppBaseUrl()

  if (!session?.user?.id) {
    const returnTo = `${url.pathname}${url.search}`
    return NextResponse.redirect(`${base}/sign-in?redirect=${encodeURIComponent(returnTo)}`)
  }

  const confirm = new URL(`${base}/oauth/authorize`)
  confirm.searchParams.set('client_id', clientId)
  confirm.searchParams.set('client_name', 'OpenMCP Store MCP')
  confirm.searchParams.set('redirect_uri', redirectUri)
  confirm.searchParams.set('scope', scope)
  if (state) confirm.searchParams.set('state', state)
  if (codeChallenge) confirm.searchParams.set('code_challenge', codeChallenge)
  if (codeChallengeMethod) confirm.searchParams.set('code_challenge_method', codeChallengeMethod)

  return NextResponse.redirect(confirm.toString())
}

/**
 * POST /api/mcp/store/oauth/authorize
 * Dual mode:
 * 1) Device Code: { user_code, action: 'authorize'|'deny' } (from /device page)
 * 2) Auth Code: { client_id, redirect_uri, action, ... } (from /oauth/authorize page)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const action = body.action === 'deny' ? 'deny' : 'authorize'

    // Device Code path
    if (typeof body.user_code === 'string' && body.user_code) {
      const result = await authorizeDeviceCode({
        userCode: body.user_code,
        userId: session.user.id,
        action,
      })
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json({ success: true, action })
    }

    // Authorization Code path
    const clientId = String(body.client_id || STORE_OAUTH_CLIENT_ID)
    const redirectUri = String(body.redirect_uri || '')
    const scope = String(body.scope || DEFAULT_SCOPE)
    const state = body.state ? String(body.state) : null

    if (!redirectUri) {
      return NextResponse.json({ error: '缺少 redirect_uri' }, { status: 400 })
    }

    if (action === 'deny') {
      const denyUrl = new URL(redirectUri)
      denyUrl.searchParams.set('error', 'access_denied')
      if (state) denyUrl.searchParams.set('state', state)
      return NextResponse.json({ redirect: denyUrl.toString() })
    }

    const created = await createAuthorizationCode({
      clientId,
      redirectUri,
      userId: session.user.id,
      scope,
      state,
      codeChallenge: body.code_challenge ? String(body.code_challenge) : null,
      codeChallengeMethod: body.code_challenge_method ? String(body.code_challenge_method) : null,
    })

    if ('error' in created) {
      return NextResponse.json({ error: created.error }, { status: 400 })
    }

    const redirect = new URL(redirectUri)
    redirect.searchParams.set('code', created.code)
    if (state) redirect.searchParams.set('state', state)

    return NextResponse.json({ redirect: redirect.toString() })
  } catch (error) {
    console.error('[oauth/authorize]', error)
    return NextResponse.json({ error: '授权失败' }, { status: 500 })
  }
}
