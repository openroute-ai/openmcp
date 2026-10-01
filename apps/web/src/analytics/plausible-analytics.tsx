'use client'

import Script from 'next/script'

/**
 * Plausible Analytics
 *
 * NOTICE:
 * Plausible reports 404s with no extra script, as long as "404 error pages"
 * was checked when the site was set up.
 *
 * https://plausible.io
 * https://openroute.cn/docs/analytics#plausible
 */
export function PlausibleAnalytics() {
  if (process.env.NODE_ENV !== 'production') {
    return null
  }

  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN as string
  if (!domain) {
    return null
  }

  const script = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT as string
  if (!script) {
    return null
  }

  return <Script defer type="text/javascript" data-domain={domain} src={script} />
}
