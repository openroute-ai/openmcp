import { type NextRequest, NextResponse } from 'next/server'
import { handleStoreMcpRequest, resolveStoreAuth, storeServerInfo } from '@/lib/agent-install/store-mcp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-litellm-api-key, mcp-session-id',
  'Access-Control-Expose-Headers': 'mcp-session-id',
}

function withCors(res: NextResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v)
  }
  return res
}

/** Discovery / health for agents registering the Store MCP. */
export async function GET() {
  return withCors(
    NextResponse.json({
      ...storeServerInfo(),
      protocol: 'mcp',
      transport: 'streamable-http',
      jsonrpc: '2.0',
    })
  )
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }))
}

/**
 * MCP JSON-RPC endpoint: initialize / tools/list / tools/call.
 * search_assets & get_asset are anonymous; install_asset requires auth.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveStoreAuth(request)
    const body = await request.json()
    const result = await handleStoreMcpRequest(body, auth, {
      ipAddress:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip'),
      userAgent: request.headers.get('user-agent'),
    })

    if (result === null) {
      return withCors(new NextResponse(null, { status: 204 }))
    }

    return withCors(NextResponse.json(result))
  } catch (error) {
    console.error('[api/mcp/store]', error)
    return withCors(
      NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        { status: 400 }
      )
    )
  }
}
