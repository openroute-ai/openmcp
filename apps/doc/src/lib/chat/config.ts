import "server-only"

/** AI Chat 配置：优先专用 AI_CHAT_*，其次 DeepSeek / OpenAI 兼容环境变量。 */
export const chatConfig = {
  baseURL: () =>
    process.env.AI_CHAT_BASE_URL?.trim() ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.deepseek.com",
  apiKey: () =>
    process.env.AI_CHAT_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim(),
  model: () =>
    process.env.AI_CHAT_MODEL?.trim() ||
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "deepseek-chat",
  maxSteps: () => {
    const raw = parseInt(process.env.CHAT_MAX_STEPS ?? "", 10)
    return Number.isFinite(raw) && raw > 0 && raw <= 12 ? raw : 6
  },
  rateLimitPerMin: () => {
    const raw = parseInt(process.env.CHAT_RATE_LIMIT_PER_MIN ?? "", 10)
    return Number.isFinite(raw) && raw > 0 ? raw : 10
  },
}

export function isChatConfigured(): boolean {
  return Boolean(chatConfig.apiKey())
}
