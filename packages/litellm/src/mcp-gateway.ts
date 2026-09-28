import { LiteLLMBaseManager } from './base'

/**
 * LiteLLM MCP Gateway（v1.80+）
 * 文档：https://docs.litellm.ai/docs/mcp
 *
 * POST   /v1/mcp/server
 * GET    /v1/mcp/server
 * GET    /v1/mcp/server/{server_id}
 * PUT    /v1/mcp/server
 * DELETE /v1/mcp/server/{server_id}
 * GET    /v1/mcp/server/health
 * GET    /mcp-rest/tools/list
 * POST   /mcp-rest/tools/call
 */

export type LiteLLMMcpTransport = 'http' | 'sse' | 'stdio'

export type LiteLLMMcpAuthType =
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'basic'
  | 'authorization'
  | 'token'
  | 'oauth2'
  | 'oauth2_token_exchange'
  | 'aws_sigv4'

export interface NewMcpServerRequest {
  server_id?: string
  server_name: string
  alias?: string
  url?: string
  transport?: LiteLLMMcpTransport
  description?: string
  auth_type?: LiteLLMMcpAuthType
  auth_value?: string
  mcp_info?: Record<string, unknown>
  extra_headers?: string[]
  static_headers?: Record<string, string>
  allowed_tools?: string[]
  disallowed_tools?: string[]
  oauth2_flow?: 'client_credentials' | 'authorization_code'
  client_id?: string
  client_secret?: string
  token_url?: string
  authorization_url?: string
  registration_url?: string
  scopes?: string[]
  allow_all_keys?: boolean
  spec_version?: string
}

export interface UpdateMcpServerRequest extends Partial<NewMcpServerRequest> {
  server_id: string
}

export interface LiteLLMMcpServer {
  server_id: string
  server_name?: string
  alias?: string
  url?: string | null
  transport?: LiteLLMMcpTransport
  auth_type?: LiteLLMMcpAuthType | null
  description?: string | null
  status?: string
  last_health_check?: string | null
  health_check_error?: string | null
  [key: string]: unknown
}

export interface McpRestTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  [key: string]: unknown
}

export interface McpHealthItem {
  server_id: string
  status: string
}

export class LiteLLMMcpGatewayManager extends LiteLLMBaseManager {
  async createServer(payload: NewMcpServerRequest) {
    return this.request<LiteLLMMcpServer>('/v1/mcp/server', 'POST', payload)
  }

  async updateServer(payload: UpdateMcpServerRequest) {
    return this.request<LiteLLMMcpServer>('/v1/mcp/server', 'PUT', payload)
  }

  async deleteServer(serverId: string) {
    return this.request<{ ok?: boolean }>(`/v1/mcp/server/${encodeURIComponent(serverId)}`, 'DELETE')
  }

  async getServer(serverId: string) {
    return this.request<LiteLLMMcpServer>(`/v1/mcp/server/${encodeURIComponent(serverId)}`, 'GET')
  }

  async listServers(teamId?: string) {
    const qs = teamId ? `?${this.buildQueryString({ team_id: teamId })}` : ''
    return this.request<LiteLLMMcpServer[]>(`/v1/mcp/server${qs}`, 'GET')
  }

  async healthCheck(serverIds?: string[]) {
    const qs = serverIds?.length ? `?${this.buildQueryString({ server_ids: serverIds })}` : ''
    return this.request<McpHealthItem[]>(`/v1/mcp/server/health${qs}`, 'GET')
  }

  async listTools(serverId?: string) {
    const qs = serverId ? `?${this.buildQueryString({ server_id: serverId })}` : ''
    return this.request<{ tools: McpRestTool[] }>(`/mcp-rest/tools/list${qs}`, 'GET')
  }

  /**
   * LiteLLM 最新 MCP REST：`server_id` 可为 UUID / server_name / alias。
   * @see https://docs.litellm.ai/docs/mcp_rest_api
   */
  async callTool(name: string, arguments_: Record<string, unknown>, serverId?: string) {
    return this.request<unknown>('/mcp-rest/tools/call', 'POST', {
      name,
      arguments: arguments_ ?? {},
      ...(serverId ? { server_id: serverId } : {}),
    })
  }

  async discover(url: string, authValue?: string) {
    return this.request<Record<string, unknown>>('/v1/mcp/discover', 'POST', {
      url,
      ...(authValue ? { auth_value: authValue } : {}),
    })
  }
}

export function getMcpGateway(): LiteLLMMcpGatewayManager {
  return new LiteLLMMcpGatewayManager()
}
