import { defineRouting } from "next-intl/routing"

import { i18n } from "@/lib/config/i18n"

export const DEFAULT_LOCALE = i18n.defaultLocale
export const LOCALES = Object.keys(i18n.locales)

/** The cookie next-intl reads to remember a chosen locale. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE"

/**
 * Internationalized routing.
 *
 * https://next-intl.dev/docs/routing
 *
 * `localePrefix: "as-needed"` keeps the default locale unprefixed, so
 * `/dashboard` stays a valid URL and only the other locales appear in the
 * path. Detection is off: an internal console that switched language because
 * of an Accept-Language header would be surprising, and the console is only
 * ever reached by someone who can sign in to it.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localeDetection: false,
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
  },
  localePrefix: "as-needed",
})
