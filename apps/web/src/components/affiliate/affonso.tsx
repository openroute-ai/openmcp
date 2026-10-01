import Script from 'next/script'

/**
 * Affonso affiliate pixel
 *
 * https://affonso.com
 *
 * Off unless `enableAffonsoAffiliate` is on *and* the affiliate id is present,
 * so a missing env var cannot leave a live pixel pointing at nobody's account.
 */
export function AffonsoScript() {
  if (process.env.NODE_ENV !== 'production') {
    return null
  }

  if (!process.env.NEXT_PUBLIC_AFFILIATE_AFFONSO_ID) {
    return null
  }

  return (
    <Script
      src="https://affonso.io/js/pixel.min.js"
      strategy="afterInteractive"
      data-affonso={process.env.NEXT_PUBLIC_AFFILIATE_AFFONSO_ID}
      data-cookie_duration="30"
    />
  )
}
