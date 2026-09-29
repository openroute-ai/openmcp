import { createNavigation } from "next-intl/navigation"

import { routing } from "./routing"

/**
 * Locale-aware replacements for the Next.js navigation APIs.
 *
 * `next/link` and `next/navigation` are not used directly in the UI: they
 * would drop or double the locale prefix, because they know nothing about it.
 *
 * https://next-intl.dev/docs/routing/navigation
 */
export const {
  Link: LocaleLink,
  getPathname: getLocalePathname,
  redirect: localeRedirect,
  usePathname: useLocalePathname,
  useRouter: useLocaleRouter,
} = createNavigation(routing)
