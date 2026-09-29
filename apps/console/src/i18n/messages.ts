import deepmerge from "deepmerge"
import type { Messages } from "next-intl"

import { routing } from "./routing"

type Locale = (typeof routing.locales)[number]

/**
 * A message tree, with no claim about which keys it holds.
 *
 * The merge is generic, so it is typed generically: requiring the app's full
 * catalog would mean a caller could not merge two groups of messages, and the
 * test for the fallback could not use a two-key fixture.
 */
type MessageTree = Record<string, unknown>

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
 * Lays a translation over the default locale, keeping the default's keys that
 * the translation does not mention.
 *
 * Exported on its own so the fallback is a thing that can be tested with two
 * objects, rather than only observable as "the page looked fine".
 */
export const mergeMessages = (
  base: MessageTree,
  overlay: MessageTree
): MessageTree => deepmerge(base, overlay)

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

  return mergeMessages(await getDefaultMessages(), localeMessages) as Messages
}
