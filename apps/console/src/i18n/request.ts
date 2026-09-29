import { hasLocale } from "next-intl"
import { getRequestConfig } from "next-intl/server"

import { getMessagesForLocale } from "./messages"
import { routing } from "./routing"

/**
 * Server-side i18n configuration.
 *
 * React caches the returned config per request, so the first component to ask
 * for a message decides it.
 *
 * https://next-intl.dev/docs/usage/configuration
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // This is the `[locale]` segment; anything that is not a supported locale
  // falls back rather than rendering a page with no messages.
  // https://next-intl.dev/docs/blog/next-intl-4-0#strictly-typed-locale
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  return {
    locale,
    messages: await getMessagesForLocale(locale),
  }
})
