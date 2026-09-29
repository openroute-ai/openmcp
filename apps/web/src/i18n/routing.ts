import { defineRouting } from 'next-intl/routing'
import { websiteConfig } from '@/lib/config/website'

export const DEFAULT_LOCALE = websiteConfig.i18n.defaultLocale
export const LOCALES = Object.keys(websiteConfig.i18n.locales) as Array<
  keyof typeof websiteConfig.i18n.locales
>

/** Cookie that remembers the visitor's chosen locale. */
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE'

/**
 * Next.js internationalized routing.
 *
 * https://next-intl.dev/docs/routing
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Detection is handled by the locale switcher rather than Accept-Language,
  // so a shared link always renders the locale it was written in.
  localeDetection: false,
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
  },
  localePrefix: websiteConfig.routes.localePrefix,
})

export type Locale = (typeof routing.locales)[number]

/**
 * Narrows a raw route param (typed `string` by Next.js) to a configured
 * `Locale`. The locale layout has already rejected unknown values, so callers
 * that run beneath it can treat a failure as unreachable.
 */
export function assertLocale(value: string): Locale {
  if (!(routing.locales as readonly string[]).includes(value)) {
    throw new Error(`Unsupported locale: ${value}`)
  }
  return value as Locale
}
