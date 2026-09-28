import { LiteLLMBaseManager } from './base'

// 密钥列表查询参数接口
export interface GetKeyListParams {
  page?: number // 页码
  size?: number // 每页数量
  user_id: string // 用户ID
  team_id?: string | null // 团队ID
  organization_id?: string | null // 组织ID
  key_hash?: string | null // 密钥哈希
  key_alias?: string | null // 密钥别名
  return_full_object?: boolean // 是否返回完整对象
  include_team_keys?: boolean // 是否包含团队密钥
  sort_by?: string | null // 排序字段
  sort_order?: 'asc' | 'desc' // 排序顺序
}

// 用户API密钥认证对象接口
export interface UserAPIKeyAuth {
  token: string // 密钥
  key_name: string // 密钥名称
  key_alias: string // 密钥别名
  spend: number // 花费
  max_budget: number // 最大预算
  expires: string // 过期时间
  models: string[] // 模型
  aliases: Record<string, any> // 别名
  config: Record<string, any> // 配置
  user_id: string // 用户ID
  team_id: string // 团队ID
  max_parallel_requests: number // 最大并发请求数
  metadata: Record<string, any> // 元数据
  tpm_limit: number // 每分钟请求数限制
  rpm_limit: number // 每秒请求数限制
  budget_duration: string // 预算持续时间
  budget_reset_at: string // 预算重置时间
  allowed_cache_controls: string[] // 允许的缓存控制
  allowed_routes: string[] // 允许的路由
  permissions: Record<string, any> // 权限
  model_spend: Record<string, any> // 模型消费
  model_max_budget: Record<string, any> // 模型最大预算
  soft_budget_cooldown: boolean // 软预算冷却
  blocked: boolean // 是否被阻止
  litellm_budget_table: Record<string, any> // 预算表
  org_id: string // 组织ID
  created_at: string // 创建时间
  created_by: string // 创建者
  updated_at: string // 更新时间
  updated_by: string // 更新者
  object_permission_id: string // 对象权限ID
  object_permission: {
    object_permission_id: string // 对象权限ID
    mcp_servers: any[] // MCP服务器
    mcp_access_groups: any[] // MCP访问组
    vector_stores: any[] // 向量存储
  }
  team_spend: number // 团队花费
  team_alias: string // 团队别名
  team_tpm_limit: number // 团队每分钟请求数限制
  team_rpm_limit: number // 团队每秒请求数限制
  team_max_budget: number // 团队最大预算
  team_models: string[] // 团队模型
  team_blocked: boolean // 团队是否被阻止
  soft_budget: number // 软预算
  team_model_aliases: Record<string, any> // 团队模型别名
  team_member_spend: number // 团队成员花费
  team_member: {
    user_id: string // 用户ID
    user_email: string // 用户邮箱
    role: string // 角色
  }
  team_metadata: Record<string, any> // 团队元数据
  end_user_id: string
  end_user_tpm_limit: number // 终端用户每分钟请求数限制
  end_user_rpm_limit: number // 终端用户每秒请求数限制
  end_user_max_budget: number // 终端用户最大预算
  last_refreshed_at: number // 最后刷新时间
  api_key: string // 密钥
  user_role: string // 用户角色
  allowed_model_region: string // 允许的模型区域
  parent_otel_span: string // 父OTEL span
  rpm_limit_per_model: Record<string, number> // 每模型每秒请求数限制
  tpm_limit_per_model: Record<string, number> // 每模型每分钟请求数限制
  user_tpm_limit: number // 用户每分钟请求数限制
  user_rpm_limit: number // 用户每秒请求数限制
  user_email: string // 用户邮箱
  request_route: string // 请求路由
}

// 密钥列表响应接口
export interface GetKeyListResponse {
  keys: string[] | UserAPIKeyAuth[] // 密钥列表
  total_count: number // 总数量
  current_page: number // 当前页码
  total_pages: number // 总页数
}

export interface GenerateKeyParams {
  duration?: string // 持续时间
  key_alias?: string // 密钥别名
  key?: string // 密钥，这里存放的是密文，用户只有第一次可以看到真实的key，后续都是token
  // token?: string; // 密钥token，即经过加密的key，与key一一对应，key是明文，token是密文
  team_id?: string // 团队ID
  user_id?: string // 用户ID
  budget_id?: string // 预算ID
  models?: string[] // 模型
  aliases?: Record<string, string> // 别名
  config?: Record<string, any> // 配置
  spend?: number // 花费
  send_invite_email?: boolean // 是否发送邀请邮件
  max_budget?: number // 最大预算
  budget_duration?: string // 预算持续时间
  max_parallel_requests?: number // 最大并发请求数
  metadata?: Record<string, any> // 元数据
  guardrails?: string[] // 守卫
  permissions?: Record<string, any> // 权限
  model_max_budget?: Record<string, any> // 模型最大预算
  model_rpm_limit?: Record<string, number> // 模型每秒请求数限制
  model_tpm_limit?: Record<string, number> // 模型每分钟请求数限制
  allowed_cache_controls?: string[] // 允许的缓存控制
  blocked?: boolean // 是否被阻止
  rpm_limit?: number // 每秒请求数限制
  tpm_limit?: number // 每分钟请求数限制
  soft_budget?: number // 软预算
  tags?: string[] // 标签
  enforced_params?: string[] // 强制参数
  allowed_routes?: string[] // 允许的路由
  object_permission?: Record<string, any> // 对象权限
}

export interface UpdateKeyParams extends Partial<Omit<GenerateKeyParams, 'key' | 'duration' | 'send_invite_email'>> {
  temp_budget_increase?: number // 临时预算增加
  temp_budget_expiry?: string // 临时预算过期时间
  max_budget?: number // 最大预算
}

export interface DeleteKeysRequest {
  keys?: string[] // 密钥
  key_aliases?: string[] // 密钥别名
}

export interface DeleteKeysResponse {
  deleted_keys: string[]
}

/**
 * LiteLLM 密钥管理器
 */
export class LiteLLMVirtualKeyManager extends LiteLLMBaseManager {
  /**
   * 生成密钥
   */
  async generateKey<T extends GenerateKeyParams>(params: T) {
    return this.request<{
      key: string
      token: string
      expires: string
      user_id: string
    }>('/key/generate', 'POST', params)
  }

  /**
   * 更新密钥
   */
  async updateKey(key: string, params: UpdateKeyParams) {
    return this.request<{
      key: string
      info: Record<string, any>
    }>('/key/update', 'POST', { key, ...params })
  }

  /**
   * 删除密钥
   */
  async deleteKeys(params: DeleteKeysRequest) {
    return this.request<DeleteKeysResponse>('/key/delete', 'POST', params)
  }

  /**
   * 获取密钥信息
   * @param key 密钥
   * @returns 密钥信息
   */
  async getKeyInfo(key: string) {
    return this.request<{
      key: string
      info: Record<string, any>
    }>('/key/info', 'GET', { key })
  }

  /**
   * 获取密钥列表
   * @param params 查询参数
   * @returns 密钥列表响应
   */
  async getKeyList(params?: GetKeyListParams): Promise<GetKeyListResponse> {
    const queryString = this.buildQueryString(params || {})
    const endpoint = queryString ? `/key/list?${queryString}` : '/key/list'
    return this.request<GetKeyListResponse>(endpoint, 'GET')
  }

  /**
   * 禁用key
   * @param key
   */
  async blockKey(key: string) {
    return this.request<{
      token: string
      key_name: string
      key_alias: string
      spend: number
      max_budget: number
      expires: string
      models: string[]
      aliases: Record<string, any>
      config: Record<string, any>
      user_id: string
      team_id: string
      max_parallel_requests: number
      metadata: Record<string, any>
      tpm_limit: number
      rpm_limit: number
      budget_duration: string
      budget_reset_at: string
      allowed_cache_controls: string[]
      allowed_routes: string[]
      permissions: Record<string, any>
      model_spend: Record<string, any>
      model_max_budget: Record<string, any>
      soft_budget_cooldown: boolean
      blocked: boolean
      litellm_budget_table: Record<string, any>
      org_id: string
      created_at: string
      created_by: string
      updated_at: string
      updated_by: string
      object_permission_id: string
      object_permission: {
        object_permission_id: string
        mcp_servers: any[]
        mcp_access_groups: any[]
        vector_stores: any[]
      }
    }>('/key/block', 'POST', { key })
  }

  async unblockKey(key: string) {
    return this.request<string>('/key/unblock', 'POST', { key })
  }
}
