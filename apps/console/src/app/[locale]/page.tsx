import { hasLocale } from "next-intl"

import { localeRedirect } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"
import { getSessionUser } from "@/lib/auth/session"
import { landingPathFor } from "@/lib/auth/role"

export const dynamic = "force-dynamic"

/**
 * The root path, which only exists to send each visitor to their own console.
 *
 * The landing is a function of the account's role, so the decision is made here,
 * once, and everything that needs it asks `landingPathFor` rather than repeating
 * the branch: `/dashboard` for an admin, `/console` for anyone else signed in,
 * and `/sign-in` for nobody at all — which is what a session cookie whose
 * session has expired looks like, and the case the proxy's cookie check cannot
 * tell apart from a live one.
 *
 * `localeRedirect` rather than the Next.js one so the redirect keeps the
 * visitor's locale: a plain redirect to `/dashboard` would drop a `/zh` visitor
 * onto the default locale.
 */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const user = await getSessionUser()

  // The layout already sends an unsupported locale to `notFound`, so this only
  // narrows the type: Next.js types the param as a string whatever the segment
  // matched, and a redirect built from an unvalidated one could name a locale
  // that has no messages.
  localeRedirect({
    href: landingPathFor(user),
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  })
}
