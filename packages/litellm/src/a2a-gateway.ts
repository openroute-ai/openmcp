import { LiteLLMBaseManager } from './base'

/**
 * LiteLLM A2A Agent Gateway
 * 文档：https://docs.litellm.ai/docs/a2a
 *
 * POST   /v1/agents
 * GET    /v1/agents
 * GET    /v1/agents/{agent_id}
 * PATCH  /v1/agents/{agent_id}
 * DELETE /v1/agents/{agent_id}
 * POST   /v1/a2a/discover
 * POST   /a2a/{agent_id}
 */

export type A2aProtocolVersion = '0.3' | '1.0'

export interface A2aAgentCardParams {
  url: string
  protocolVersion?: A2aProtocolVersion
  name?: string
  description?: string
  version?: string
  skills?: unknown[]
  capabilities?: Record<string, unknown>
  [key: string]: unknown
}

export interface NewA2aAgentRequest {
  agent_name: string
  agent_card_params: A2aAgentCardParams
  extra_headers?: string[]
  static_headers?: Record<string, string>
  litellm_params?: Record<string, unknown>
}

export interface LiteLLMA2aAgent {
  agent_id: string
  agent_name: string
  agent_card_params?: A2aAgentCardParams
  static_headers?: Record<string, string>
  extra_headers?: string[]
  [key: string]: unknown
}

export interface A2aDiscoverRequest {
  url: string
  mode?: 'well_known_fallback' | 'langgraph_platform'
}

export class LiteLLMA2aGatewayManager extends LiteLLMBaseManager {
  async createAgent(payload: NewA2aAgentRequest) {
    return this.request<LiteLLMA2aAgent>('/v1/agents', 'POST', payload)
  }

  async updateAgent(agentId: string, payload: Partial<NewA2aAgentRequest>) {
    return this.request<LiteLLMA2aAgent>(`/v1/agents/${encodeURIComponent(agentId)}`, 'PATCH', payload)
  }

  async deleteAgent(agentId: string) {
    return this.request<{ ok?: boolean }>(`/v1/agents/${encodeURIComponent(agentId)}`, 'DELETE')
  }

  async getAgent(agentId: string) {
    return this.request<LiteLLMA2aAgent>(`/v1/agents/${encodeURIComponent(agentId)}`, 'GET')
  }

  async listAgents(query?: string, topK?: number) {
    const qs = this.buildQueryString({ query, top_k: topK })
    return this.request<LiteLLMA2aAgent[]>(`/v1/agents${qs ? `?${qs}` : ''}`, 'GET')
  }

  async discover(payload: A2aDiscoverRequest) {
    return this.request<Record<string, unknown>>('/v1/a2a/discover', 'POST', payload)
  }

  async invoke(agentId: string, body: Record<string, unknown>) {
    return this.request<unknown>(`/a2a/${encodeURIComponent(agentId)}`, 'POST', body)
  }

  /** LiteLLM 最新 message/send 别名：POST /a2a/{agent_id}/message/send */
  async sendMessage(agentId: string, text: string) {
    return this.request<unknown>(`/a2a/${encodeURIComponent(agentId)}/message/send`, 'POST', {
      jsonrpc: '2.0',
      id: `sandbox-${Date.now()}`,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text }],
          messageId: `msg-${Date.now()}`,
        },
      },
    })
  }
}

export function getA2aGateway(): LiteLLMA2aGatewayManager {
  return new LiteLLMA2aGatewayManager()
}
