import { getBaseUrl } from "@/lib/urls/urls"

/** Public LiteLLM / platform gateway base (no trailing slash). */
export function getGatewayBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_GATEWAY_BASE_URL || process.env.NEXT_PUBLIC_LITELLM_PUBLIC_URL || 'https://api.openmcp.cn'
  return raw.replace(/\/$/, '')
}

export function getAppBaseUrl(origin?: string): string {
  return (origin || getBaseUrl()).replace(/\/$/, '')
}

/** Platform gateway MCP URL for a registered server — never Provider endpoint. */
export function buildMcpGatewayUrl(serverName: string): string {
  const name = serverName.trim().replace(/^\/+|\/+$/g, '')
  return `${getGatewayBaseUrl()}/${encodeURIComponent(name)}/mcp`
}

/** Platform gateway A2A invoke / card base for a registered agent. */
export function buildA2aGatewayUrl(agentName: string): string {
  const name = agentName.trim().replace(/^\/+|\/+$/g, '')
  return `${getGatewayBaseUrl()}/a2a/${encodeURIComponent(name)}`
}

export function buildA2aAgentCardUrl(agentName: string): string {
  return `${buildA2aGatewayUrl(agentName)}/.well-known/agent-card.json`
}

/** OpenMCP Store MCP (P1) — hosted on the app, registerable as MCP. */
export function buildStoreMcpUrl(origin?: string): string {
  return `${getAppBaseUrl(origin)}/api/mcp/store`
}

export function buildAssetDetailUrl(kind: 'skill' | 'mcp' | 'a2a', slug: string, origin?: string): string {
  const path = kind === 'skill' ? `/skills/${slug}` : kind === 'mcp' ? `/mcp/${slug}` : `/a2a/${slug}`
  return `${getAppBaseUrl(origin)}${path}`
}

export const API_KEY_PLACEHOLDER = 'YOUR_OPENMCP_API_KEY'
export const API_KEYS_PATH = '/dashboard/apikeys'

/** Platform gateway (LiteLLM) preferred auth header; `Authorization: Bearer` also works. */
export const GATEWAY_KEY_HEADER = 'x-litellm-api-key'
