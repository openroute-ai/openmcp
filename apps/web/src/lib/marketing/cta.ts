import { Routes } from '@/lib/routes'

/**
 * 落地页 CTA 的唯一跳转目标。
 * 文案统一放在 `Landing.cta` 消息里（en/zh），避免同义漂移导致转化归因失效；
 * 这里只保留与语言无关的 href。
 */
export const MARKET_CTA = {
  href: Routes.Skills,
} as const

export const PROVIDER_CTA = {
  href: Routes.ProviderOnboarding,
} as const

/** Provider 侧的具体动作，按目标人群区分 */
export const SUBMIT_SKILL_CTA = {
  href: Routes.SkillSubmit,
} as const

export const PROVIDER_JOIN_CTA = {
  href: Routes.ProviderOnboarding,
} as const

/** 收敛的浏览侧链接，供协议货架等需要区分目标的场景使用 */
export const SKILLS_LINK = { href: Routes.Skills } as const
export const MCP_LINK = { href: Routes.MCP } as const
export const A2A_LINK = { href: Routes.A2A } as const
