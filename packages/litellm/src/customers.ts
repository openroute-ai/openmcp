import { LiteLLMBaseManager } from './base'

export interface CreateCustomerParams {
  user_id: string
  alias?: string
  blocked?: boolean
  max_budget?: number
  budget_id?: string
  allowed_model_region?: 'eu' | 'us'
  default_model?: string
  metadata?: Record<string, any>
  budget_duration?: string
  tpm_limit?: number
  rpm_limit?: number
  model_max_budget?: Record<string, { max_budget: number; budget_duration: string }>
  max_parallel_requests?: number
  soft_budget?: number
  spend?: number
  budget_reset_at?: string
}

export interface EndUserInfo {
  user_id: string
  blocked: boolean
  alias: string
  spend: number
  allowed_model_region?: 'eu' | 'us'
  default_model?: string
  litellm_budget_table: {
    budget_id?: string
    soft_budget?: number
    max_budget?: number
    max_parallel_requests?: number
    tpm_limit?: number
    rpm_limit?: number
    model_max_budget?: Record<string, any>
    budget_duration?: string
  }
}

/**
 * LiteLLM 客户管理器
 */
export class LiteLLMCustomerManager extends LiteLLMBaseManager {
  /**
   * 获取客户信息
   */
  async getCustomerInfo(customerId: string) {
    const queryString = this.buildQueryString({ customer_id: customerId })
    return this.request<EndUserInfo>(`/customer/info?${queryString}`, 'GET')
  }
}
