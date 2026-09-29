import { websiteConfig } from '@/lib/config/website'
import type { Locale } from '@/i18n/routing'
import { routing } from '@/i18n/routing'

/**
 * Base URL of this deployment, used for absolute links in emails, OAuth
 * callbacks and server-side tRPC calls.
 */
const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL ??
  (process.env.NODE_ENV === 'production'
    ? websiteConfig.metadata.base_url
    : `http://localhost:${process.env.PORT ?? 3000}`)

export function getBaseUrl(): string {
  return baseUrl
}

/** The default locale is unprefixed, every other locale gets a `/<locale>` prefix. */
export function shouldAppendLocale(locale?: Locale | null): boolean {
  return !!locale && locale !== routing.defaultLocale
}

export function getUrlWithLocale(url: string, locale?: Locale | null): string {
  return shouldAppendLocale(locale) ? `${baseUrl}/${locale}${url}` : `${baseUrl}${url}`
}

/**
 * Adds the locale to the `callbackURL` parameter of a better-auth URL, so the
 * user lands back on the page in the language they started from.
 *
 * https://www.better-auth.com/docs/concepts/email
 */
export function getUrlWithLocaleInCallbackUrl(
  url: string,
  locale: Locale
): string {
  if (!shouldAppendLocale(locale)) {
    return url
  }

  try {
    const urlObj = new URL(url)
    const callbackURL = urlObj.searchParams.get('callbackURL')

    if (callbackURL) {
      // Don't double-prefix a callback that already carries the locale
      if (!callbackURL.match(new RegExp(`^/${locale}(/|$)`))) {
        const localizedCallbackURL = callbackURL.startsWith('/')
          ? `/${locale}${callbackURL}`
          : `/${locale}/${callbackURL}`

        urlObj.searchParams.set('callbackURL', localizedCallbackURL)
      }
    }

    return urlObj.toString()
  } catch {
    // Return the original URL if it is not a valid absolute URL
    return url
  }
}

/**
 * Absolute URL for a static asset or path, useful in metadata and emails.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, baseUrl).toString()
}
