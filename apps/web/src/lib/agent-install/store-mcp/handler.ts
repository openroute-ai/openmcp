import type { StoreAuthResult } from './auth'
import { STORE_MCP_TOOLS, callStoreTool, storeServerInfo } from './tools'

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }
}

const PROTOCOL_VERSION = '2025-11-25'

export async function handleStoreMcpRequest(
  body: JsonRpcRequest | JsonRpcRequest[],
  auth: StoreAuthResult,
  meta?: { ipAddress?: string | null; userAgent?: string | null }
): Promise<unknown> {
  if (Array.isArray(body)) {
    const results = []
    for (const item of body) {
      results.push(await handleOne(item, auth, meta))
    }
    return results
  }
  return handleOne(body, auth, meta)
}

async function handleOne(
  body: JsonRpcRequest,
  auth: StoreAuthResult,
  meta?: { ipAddress?: string | null; userAgent?: string | null }
) {
  const id = body.id ?? null
  const method = body.method

  if (!method) {
    return rpcError(id, -32600, 'Invalid Request: missing method')
  }

  // Notifications have no id and expect no response body in some transports;
  // we still return null so the route can answer 204 / empty.
  const isNotification = body.id === undefined || body.id === null

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'openmcp-store',
          version: '1.0.0',
        },
        instructions:
          'OpenMCP Store MCP. Use search_assets / get_asset anonymously; install_asset requires Authorization Bearer API Key or OAuth Device Code token.',
      })

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return isNotification ? null : rpcResult(id, {})

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, {
        tools: STORE_MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case 'tools/call': {
      const params = body.params ?? {}
      const name = String(params.name ?? '')
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {}
      if (!name) return rpcError(id, -32602, 'Invalid params: missing tool name')
      try {
        const result = await callStoreTool(name, args, auth, meta)
        return rpcResult(id, result)
      } catch (error) {
        console.error('[store-mcp] tools/call', name, error)
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: '工具执行失败' }) }],
          isError: true,
        })
      }
    }

    case 'resources/list':
      return rpcResult(id, { resources: [] })

    case 'prompts/list':
      return rpcResult(id, { prompts: [] })

    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export { storeServerInfo }
