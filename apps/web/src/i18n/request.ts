import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { getMessagesForLocale } from './messages'
import { routing } from './routing'

/**
 * Request-scoped i18n configuration for server components and actions.
 *
 * The config is memoised per request by next-intl, so the message catalogue is
 * imported at most once per render pass.
 *
 * https://next-intl.dev/docs/usage/configuration
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale

  // Fall back to the default locale when the URL carries an unknown one
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  return {
    locale,
    messages: await getMessagesForLocale(locale),
  }
})
