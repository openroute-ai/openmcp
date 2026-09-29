import { localeRedirect } from "@/i18n/navigation"

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
  localeRedirect({ href: "/dashboard", locale })
}
