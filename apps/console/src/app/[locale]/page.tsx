import type { Metadata } from "next"
import { hasLocale } from "next-intl"

import { DeepDives } from "@/components/landing/deep-dives"
import { Comparison, Neutrality, Roles, Testimonials } from "@/components/landing/proof"
import { Faq, FinalCta, Pricing, ReportDownload } from "@/components/landing/pricing-downloads"
import { Hero } from "@/components/landing/hero"
import { SiteFooter } from "@/components/landing/site-footer"
import { SiteHeader } from "@/components/landing/site-header"
import { PainPoints, Solutions, TrustStrip, Workflow } from "@/components/landing/sections-top"
import { localeRedirect } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"
import { getSessionUser } from "@/lib/auth/session"
import { landingPathFor } from "@/lib/auth/role"

import "./landing.css"

export const dynamic = "force-dynamic"

/**
 * Radar's public marketing surface, and the root path.
 *
 * Two audiences land here and they get different things:
 *
 *   - Someone signed in already has a place to be. `landingPathFor` sends an
 *     admin to `/dashboard` and anyone else to `/console`, and a session whose
 *     cookie has expired falls through to `/sign-in` — which is the one case the
 *     proxy's cookie check cannot tell apart from a live session.
 *   - Everyone else gets the landing page, whose first screen is the live
 *     anomaly feed rather than a pitch (docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.9.4).
 *
 * The role branch is made once, here, so nothing downstream has to repeat it.
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
  const locale_ = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale

  if (user) {
    localeRedirect({ href: landingPathFor(user), locale: locale_ })
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <SiteHeader />
      <main>
        <Hero />
        <TrustStrip />
        <PainPoints />
        <Solutions />
        <DeepDives />
        <Workflow />
        <Comparison />
        <Roles />
        <Neutrality />
        <Testimonials />
        <Pricing />
        <ReportDownload />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}

export const metadata: Metadata = {
  metadataBase: new URL("https://radar.openmcp.cn"),
  title: "OpenMCP 雷达 — 开源项目异动监控",
  description:
    "记录每个 stargazer 的到达时间，据此判断一个开源项目正在变好还是变坏。增速断崖、维护停滞、许可证变更，全部免费公开，每条结论可点开看原始时间轴。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "OpenMCP 雷达",
    locale: "zh_CN",
    title: "OpenMCP 雷达 — 开源项目异动监控",
    description:
      "别人告诉你这个项目多受欢迎，我们告诉你它正在变好还是变坏。异动、证据链、时间序列，全部免费公开。",
    url: "https://radar.openmcp.cn",
  },
  twitter: { card: "summary_large_image" },
}
