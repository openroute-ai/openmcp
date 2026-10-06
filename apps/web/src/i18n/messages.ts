import deepmerge from 'deepmerge'
import type { Locale } from './routing'
import { routing } from './routing'

/**
 * Default message catalogue, exported so components and tests can reference the
 * same shape the request configuration loads.
 */
export { default as defaultMessages } from '../../messages/zh.json'

type Messages = Record<string, unknown>

const importLocale = async (locale: Locale): Promise<Messages> => {
  return (await import(`../../messages/${locale}.json`)).default as Messages
}

/**
 * Messages for the default locale.
 */
export const getDefaultMessages = async (): Promise<Messages> => {
  return importLocale(routing.defaultLocale)
}

/**
 * Messages for a locale, deep-merged over the default locale.
 *
 * A partially translated catalogue falls back key by key instead of rendering
 * raw message ids.
 *
 * https://next-intl.dev/docs/usage/configuration#messages
 */
export const getMessagesForLocale = async (locale: Locale): Promise<Messages> => {
  const localeMessages = await importLocale(locale)
  if (locale === routing.defaultLocale) {
    return localeMessages
  }
  const defaults = await getDefaultMessages()
  return deepmerge(defaults, localeMessages)
}
