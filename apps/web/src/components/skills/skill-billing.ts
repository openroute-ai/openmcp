import { formatCurrency } from '@/lib/utils/formatter'

/**
 * Display-only billing helpers.
 *
 * These were previously exported from `skill-purchase.tsx`, but that file also
 * holds the checkout/download flow, which needs the payment + agent-install
 * seams that are not ported yet. Keeping the pure formatters here lets the
 * browse surfaces render prices without pulling in that coupling.
 */
export type SkillBillingModel = 'one_time' | 'subscription' | 'pay_per_call' | null

export function formatSkillPriceDisplay(
  priceType: 'free' | 'paid',
  priceAmount: string | null,
  currency: string,
  locale: 'zh' | 'en'
): string {
  if (priceType === 'free') {
    return locale === 'zh' ? '免费' : 'Free'
  }
  const amount = priceAmount ?? '0'
  return formatCurrency(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function describeBillingModel(
  billingModel: SkillBillingModel,
  priceType: 'free' | 'paid',
  locale: 'zh' | 'en'
): string {
  if (locale === 'en') {
    if (priceType === 'free') return 'Free to use'
    if (billingModel === 'subscription') return 'Subscription'
    if (billingModel === 'pay_per_call') return 'Pay per use'
    if (billingModel === 'one_time') return 'One-time purchase'
    return 'Paid'
  }
  if (priceType === 'free') return '免费使用'
  if (billingModel === 'subscription') return '订阅制'
  if (billingModel === 'pay_per_call') return '按次计费'
  if (billingModel === 'one_time') return '一次性购买'
  return '付费购买'
}
