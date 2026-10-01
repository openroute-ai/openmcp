import { AhrefsAnalytics } from './ahrefs-analytics'
import DataFastAnalytics from './data-fast-analytics'
import { PlausibleAnalytics } from './plausible-analytics'
import { SelineAnalytics } from './seline-analytics'
import { UmamiAnalytics } from './umami-analytics'

/**
 * Every analytics provider, in one place.
 *
 * 1. Each one is a no-op outside production, so a dev build never sends
 *    traffic to a live dashboard.
 * 2. Each one is also a no-op unless its own environment variable is set, so
 *    adding a provider is purely additive — nothing to wire up per environment.
 *
 * docs:
 * https://openroute.cn/docs/analytics
 */
export function Analytics() {
  if (process.env.NODE_ENV !== 'production') {
    return null
  }

  return (
    <>
      <UmamiAnalytics />
      <PlausibleAnalytics />
      <AhrefsAnalytics />
      <DataFastAnalytics />
      <SelineAnalytics />
    </>
  )
}
