import { NextResponse } from 'next/server'
import { createDeviceCode, STORE_OAUTH_CLIENT_ID } from '@/lib/agent-install/store-mcp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/mcp/store/oauth/device
 * RFC 8628 Device Authorization — returns device_code + user_code.
 */
export async function POST(request: Request) {
  try {
    let body: { client_id?: string; scope?: string } = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const clientId = body.client_id || STORE_OAUTH_CLIENT_ID
    const result = await createDeviceCode({
      clientId,
      scope: body.scope,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[oauth/device]', error)
    return NextResponse.json({ error: 'server_error', error_description: '生成设备码失败' }, { status: 500 })
  }
}
