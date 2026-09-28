import { LiteLLMBaseManager } from './base'

export type GroupBy = 'team' | 'customer' | 'api_key'

export interface SpendRow {
  request_id: string
  api_key: string
  model: string
  api_base: string
  call_type: string
  spend: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  startTime: string
  endTime: string
  user: string
  metadata: Record<string, any>
  cache_hit: boolean
  cache_key: string
  request_tags: string
  requester_ip_address: string
  messages: string
  response: string
}

export interface GlobalSpendReportParams {
  start_date?: string // YYYY-MM-DD
  end_date?: string // YYYY-MM-DD
  group_by?: GroupBy // 默认 team
  api_key?: string
  internal_user_id?: string
  team_id?: string
  customer_id?: string
}

export interface SpendLog {
  request_id: string
  api_key: string
  model: string
  api_base: string
  call_type: string
  spend: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  startTime: string
  endTime: string
  user: string
  metadata: Record<string, any>
  cache_hit: boolean
  cache_key: string
  request_tags: string
  requester_ip_address: string
  messages: string
  response: string
}

export interface SpendLogsParams {
  api_key?: string
  user_id?: string
  request_id?: string
  start_date?: string // YYYY-MM-DD
  end_date?: string // YYYY-MM-DD
  summarize?: boolean // 默认 true
}

export interface CalculateSpendBody {
  model?: string // 用于预估
  messages?: Array<{
    role: string
    content: string
  }>
  completion_response?: any // 用于事后计算
}

/**
 * LiteLLM 消费管理器
 */
export class LiteLLMSpendingManager extends LiteLLMBaseManager {
  /**
   * 获取全局消费报告
   */
  async getGlobalSpendReport(params: GlobalSpendReportParams = {}): Promise<SpendRow[]> {
    const queryString = this.buildQueryString(params)
    return this.request<SpendRow[]>(`/global/spend/report?${queryString}`, 'GET')
  }

  /**
   * 获取消费日志
   */
  async getSpendLogs(params: SpendLogsParams = {}): Promise<SpendLog[]> {
    const queryString = this.buildQueryString(params)
    return this.request<SpendLog[]>(`/spend/logs?${queryString}`, 'GET')
  }

  /**
   * 计算消费
   * 若返回 $0.0，需先为模型配置自定义定价（/proxy/custom_pricing）。
   * completion_response 与 model + messages 二选一，不可同时提供。
   */
  async calculateSpend(body: CalculateSpendBody): Promise<number> {
    const res = await this.request<{ cost: number }>('/spend/calculate', 'POST', body)
    return res.cost
  }
}
