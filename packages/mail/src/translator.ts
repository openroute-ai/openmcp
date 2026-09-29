import { createTranslator, type TranslationValues } from 'use-intl/core'
import type { MailLocale, MailMessages } from './types'

/**
 * Values accepted for ICU interpolation in email templates.
 */
export type MailTranslationValues = Record<
  string,
  TranslationValues[string] | undefined
>

/**
 * A translator scoped to the message catalogue passed in.
 *
 * Keys are plain strings rather than a literal union derived from the app's
 * `en.json`. Deriving the union would force this package to depend on a specific
 * app's message file, so key checking is deliberately left to the host app,
 * which does own that file.
 */
export type MailTranslator = (
  key: string,
  values?: MailTranslationValues
) => string

/**
 * Creates a translator for a locale and message catalogue.
 *
 * Wraps `use-intl/core`'s `createTranslator`, whose key type collapses to
 * `never` for an untyped message record.
 */
export const createMailTranslator = (
  locale: MailLocale,
  messages: MailMessages,
  namespace?: string
): MailTranslator => {
  const t = createTranslator({
    locale,
    messages: messages as Parameters<typeof createTranslator>[0]['messages'],
    ...(namespace ? { namespace } : {}),
  })

  return t as unknown as MailTranslator
}
