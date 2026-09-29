import { getMcpGateway, isLiteLLMConfigured } from "@workspace/litellm"
import {
  type AuthConfigInput,
  type AutoDiscoverResult,
  authHeaders,
  failAt,
  fetchWithTimeout,
  type GradedTestResult,
  type GradedTestStep,
  type McpTransportUi,
  passAll,
} from './types'

const MCP_STEPS: GradedTestStep[] = [
  { key: 'handshake', label: 'Endpoint reachable', status: 'pending' },
  { key: 'auth', label: 'Authentication', status: 'pending' },
  { key: 'tools', label: 'tools/list', status: 'pending' },
  { key: 'protocol', label: 'Protocol version match', status: 'pending' },
]

function jsonrpc(method: string, params: Record<string, unknown>, id: number) {
  return { jsonrpc: '2.0', id, method, params }
}

async function postJsonrpc(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    if (dataLine) {
      try {
        json = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
      } catch {
        json = null
      }
    }
  }
  return { status: res.status, json, text }
}

function toolNamesFromResult(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const tools = (result as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return []
  return tools
    .map((tool) => (tool && typeof tool === 'object' && 'name' in tool ? String((tool as { name: unknown }).name) : ''))
    .filter(Boolean)
}

export async function discoverMcp(url: string, auth: AuthConfigInput): Promise<AutoDiscoverResult> {
  const startedAt = Date.now()
  try {
    const test = await testMcpConnection({ url, transport: 'streamable', auth })
    if (test.ok) {
      return {
        ok: true,
        name: test.name,
        description: test.description,
        protocol: test.protocol ?? 'streamable',
        auth: auth.type,
        toolCount: test.toolCount,
        toolNames: test.toolNames,
        durationMs: Date.now() - startedAt,
      }
    }
  } catch {
    // fall through to LiteLLM discover
  }

  if (isLiteLLMConfigured()) {
    try {
      const discovered = await getMcpGateway().discover(url, auth.secret || undefined)
      const name = typeof discovered.name === 'string' ? discovered.name : undefined
      const description = typeof discovered.description === 'string' ? discovered.description : undefined
      const tools = Array.isArray(discovered.tools)
        ? discovered.tools
            .map((tool) =>
              tool && typeof tool === 'object' && 'name' in tool ? String((tool as { name: unknown }).name) : ''
            )
            .filter(Boolean)
        : []
      if (name || tools.length > 0) {
        return {
          ok: true,
          name,
          description,
          protocol: typeof discovered.transport === 'string' ? String(discovered.transport) : 'streamable',
          auth: auth.type,
          toolCount: tools.length,
          toolNames: tools,
          durationMs: Date.now() - startedAt,
        }
      }
    } catch {
      // ignore LiteLLM discover errors, return local failure
    }
  }

  return { ok: false, durationMs: Date.now() - startedAt }
}

export async function testMcpConnection(input: {
  url: string
  transport: McpTransportUi
  auth: AuthConfigInput
}): Promise<GradedTestResult> {
  const startedAt = Date.now()
  const url = input.url.trim()
  if (!url) return failAt(MCP_STEPS, 'handshake', 'Endpoint URL is required', startedAt)

  let parsed: URL
  try {
    parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return failAt(MCP_STEPS, 'handshake', 'Only http/https endpoints are supported', startedAt)
    }
  } catch {
    return failAt(MCP_STEPS, 'handshake', 'Invalid URL', startedAt)
  }

  const headers = authHeaders(input.auth)

  try {
    const init = await postJsonrpc(
      url,
      headers,
      jsonrpc(
        'initialize',
        {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'openmcp', version: '0.1.0' },
        },
        1
      )
    )

    if (init.status === 401 || init.status === 403) {
      return failAt(MCP_STEPS, 'auth', `Authentication failed (${init.status})`, startedAt)
    }
    if (init.status >= 500 || init.status === 404) {
      return failAt(MCP_STEPS, 'handshake', `Endpoint returned ${init.status}`, startedAt)
    }
    if (init.json && typeof init.json.error === 'object' && init.json.error) {
      const err = init.json.error as { code?: number; message?: string }
      if (err.code === -32000 || /auth/i.test(err.message ?? '')) {
        return failAt(MCP_STEPS, 'auth', err.message ?? 'Authentication failed', startedAt)
      }
    }

    const toolsRes = await postJsonrpc(url, headers, jsonrpc('tools/list', {}, 2))
    if (toolsRes.status === 401 || toolsRes.status === 403) {
      return failAt(MCP_STEPS, 'auth', `Authentication failed (${toolsRes.status})`, startedAt)
    }

    const result = (toolsRes.json?.result ?? toolsRes.json) as unknown
    const toolNames = toolNamesFromResult(result)
    const protocol =
      init.json && typeof init.json.result === 'object' && init.json.result
        ? String((init.json.result as { protocolVersion?: string }).protocolVersion ?? input.transport)
        : input.transport === 'sse'
          ? 'sse'
          : 'streamable'

    const serverInfo =
      init.json && typeof init.json.result === 'object' && init.json.result
        ? ((init.json.result as { serverInfo?: { name?: string } }).serverInfo ?? {})
        : {}

    return passAll(MCP_STEPS, {
      toolCount: toolNames.length,
      toolNames,
      durationMs: Date.now() - startedAt,
      protocol,
      name: serverInfo.name,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/abort/i.test(message)) {
      return failAt(MCP_STEPS, 'handshake', 'Connection timed out', startedAt)
    }
    return failAt(MCP_STEPS, 'handshake', message, startedAt)
  }
}
