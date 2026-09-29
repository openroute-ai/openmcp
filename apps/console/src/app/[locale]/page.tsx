import { hasLocale } from "next-intl"

import { localeRedirect } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"

/**
 * The root path, which only exists to send visitors into the dashboard.
 *
 * `localeRedirect` rather than the Next.js one so the redirect keeps the
 * visitor's locale: a plain redirect to `/dashboard` would drop a `/zh`
 * visitor onto the default locale.
 */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // The layout already sends an unsupported locale to `notFound`, so this only
  // narrows the type: Next.js types the param as a string whatever the segment
  // matched, and a redirect built from an unvalidated one could name a locale
  // that has no messages.
  localeRedirect({
    href: "/dashboard",
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  })
}
