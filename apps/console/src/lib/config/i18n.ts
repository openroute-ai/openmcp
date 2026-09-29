/**
 * The locales the console ships.
 *
 * Kept as configuration rather than derived from the message files so a
 * locale cannot exist without a name to show in the switcher, and so the
 * default is a deliberate choice instead of whatever `en.json` happens to
 * be.
 */
export const i18n = {
  defaultLocale: "zh",
  locales: {
    en: { label: "English" },
    zh: { label: "中文" },
  },
} as const

export type Locale = keyof typeof i18n.locales
