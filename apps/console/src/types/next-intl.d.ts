import type { routing } from "@/i18n/routing"
import type defaultMessages from "../../messages/zh.json"

type Messages = typeof defaultMessages
type Locales = (typeof routing.locales)[number]

/**
 * Ties the message keys and the locale to the application's own declarations.
 *
 * Without this, `useTranslations()` accepts any string, so a typo in a key
 * compiles and then renders the key itself on the page. With it, `t("titel")`
 * and `t("Status.completedd")` are compile errors, and the `{count}`-style
 * placeholder names are checked too.
 *
 * `Locale` matters for the same reason from the other end: it is what makes
 * `useLocale()` return the configured union instead of `string`, so a formatter
 * cannot be handed a locale nobody ships messages for.
 *
 * Both come from the sources of truth rather than a copy, so adding a locale or
 * a message needs no edit here.
 *
 * https://next-intl.dev/docs/usage/configuration#global-augmentation
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: Messages
    Locale: Locales
  }
}
