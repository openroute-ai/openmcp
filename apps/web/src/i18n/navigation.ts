import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Locale-aware navigation APIs.
 *
 * https://next-intl.dev/docs/routing/navigation
 */
export const {
  Link: LocaleLink,
  redirect: localeRedirect,
  usePathname: useLocalePathname,
  useRouter: useLocaleRouter,
  getPathname: getLocalePathname,
} = createNavigation(routing)
