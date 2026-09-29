import deepmerge from "deepmerge"
import type { Messages } from "next-intl"

import { routing } from "./routing"

type Locale = (typeof routing.locales)[number]

// The default messages are exported directly so a build step, an email
// template or a test can read them without a request.
export { default as defaultMessages } from "../../messages/en.json"

const importLocale = async (locale: Locale): Promise<Messages> => {
  return (await import(`../../messages/${locale}.json`)).default as Messages
}

export const getDefaultMessages = async (): Promise<Messages> => {
  return importLocale(routing.defaultLocale)
}

/**
 * The messages for one locale, with the default locale merged underneath.
 *
 * A translation that is missing a key falls back to English rather than
 * rendering the key itself: a half-finished translation should degrade to
 * readable text, not to `Projects.title` in the middle of a page.
 *
 * https://next-intl.dev/docs/usage/configuration#messages
 */
export const getMessagesForLocale = async (
  locale: Locale
): Promise<Messages> => {
  const localeMessages = await importLocale(locale)
  if (locale === routing.defaultLocale) {
    return localeMessages
  }

  return deepmerge(await getDefaultMessages(), localeMessages)
}
