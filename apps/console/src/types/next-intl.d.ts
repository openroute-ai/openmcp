import type defaultMessages from "../../messages/en.json"

/**
 * Ties the message keys to the default-locale catalog.
 *
 * Without this, `useTranslations()` accepts any string, so a typo in a key
 * compiles and then renders the key itself on the page. With it, `t("titel")`
 * and `t("Status.completedd")` are compile errors, and the `{count}`-style
 * placeholder names are checked too.
 *
 * The catalog here is the default locale, which is the one every other locale
 * falls back to, so it is the set of keys that has to stay complete.
 *
 * https://next-intl.dev/docs/usage/configuration#global-augmentation
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof defaultMessages
  }
}
