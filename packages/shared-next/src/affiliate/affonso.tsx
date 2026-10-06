'use client'

import Script from 'next/script'

/**
 * Affonso Affiliate
 *
 * https://affonso.com
 */
export function AffonsoScript({ enableAffonsoAffiliate }: { enableAffonsoAffiliate: boolean }) {
  if (process.env.NODE_ENV !== 'production') {
    return null
  }

  if (!enableAffonsoAffiliate) {
    return null
  }

  const affiliateId = process.env.NEXT_PUBLIC_AFFILIATE_AFFONSO_ID as string
  if (!affiliateId) {
    return null
  }

  return (
    <Script
      src='https://affonso.io/js/pixel.min.js'
      strategy='afterInteractive'
      data-affonso={affiliateId}
      data-cookie_duration='30'
    />
  )
}
