/**
 * LiteLLM 基础管理器类
 * 提供通用的 HTTP 请求方法和配置管理
 */
export abstract class LiteLLMBaseManager {
  protected baseUrl: string
  protected masterKey: string

  constructor(masterKey?: string, baseUrl?: string) {
    this.masterKey = masterKey || process.env.LITELLM_MASTER_KEY || ''
    this.baseUrl = (baseUrl || process.env.LITELLM_BASE_URL || 'http://0.0.0.0:4000').replace(/\/$/, '')

    if (!this.masterKey) {
      throw new Error(
        'LiteLLM master key is required. Set LITELLM_MASTER_KEY environment variable or pass it to constructor.'
      )
    }
  }

  /**
   * 通用 HTTP 请求方法（对齐 LiteLLM Proxy 最新管理 API）
   */
  protected async request<T = unknown>(
    endpoint: string,
    method: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.masterKey}`,
      },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${text}`)
    }

    if (!text) {
      return { ok: true } as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      return { ok: true, raw: text } as T
    }
  }

  /**
   * 构建查询字符串
   */
  protected buildQueryString(params: object): string {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) {
        for (const item of v) {
          search.append(k, String(item))
        }
        continue
      }
      search.set(k, String(v))
    }
    return search.toString()
  }
}

export function isLiteLLMConfigured(): boolean {
  return Boolean(process.env.LITELLM_MASTER_KEY)
}
