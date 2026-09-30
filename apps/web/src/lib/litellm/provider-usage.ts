/**
 * 提供者用量同步（兼容入口）
 *
 * v1.0 本文件自己拉 LiteLLM 日志并累加写入 `provider_daily_usage`，
 * 但**从不扣用户余额**——MCP/A2A 消费对 OpenMCP 是免费的，
 * 报表与真实资金流完全脱节。
 *
 * v2.0 起逻辑收敛到 `settlement.ts`（按 `request_id` 幂等扣款 + 分成 + 报表重算）。
 * 本文件保留是为了不打断已有的 cron 调度与调用方，它现在只是薄封装。
 *
 * 新代码请直接用 `settleGatewaySpend()`。
 */

import { type SettlementResult, settleGatewaySpend } from './settlement'

export const PROVIDER_ASSET_TYPES = ['mcp', 'a2a'] as const

/**
 * @param days 回看天数（含今天），默认 1 表示昨天 + 今天
 * @deprecated 使用 `settleGatewaySpend`（settleGatewaySpend 额外做扣款与分成）
 */
export async function syncProviderUsage(days = 1): Promise<SettlementResult> {
  return settleGatewaySpend(days)
}
