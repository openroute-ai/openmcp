import type { Metadata } from "next"
import { headers } from "next/headers"

import { SITE_NAME, SITE_ORIGIN } from "@/lib/config/site"
import { AnnounceBar } from "@/components/landing/announce-bar"
import { DeepDives } from "@/components/landing/deep-dives"
import {
  Comparison,
  Neutrality,
  Roles,
  Testimonials,
} from "@/components/landing/proof"
import {
  Faq,
  FinalCta,
  Pricing,
  ReportDownload,
} from "@/components/landing/pricing-downloads"
import { Hero, AnomalyQuietNote } from "@/components/landing/hero"
import { SiteFooter } from "@/components/landing/site-footer"
import { SiteNav } from "@/components/nav/site-nav"
import {
  PainPoints,
  Solutions,
  Workflow,
} from "@/components/landing/sections-top"
import { db } from "@/db/client"
import { listOpenAnomalies } from "@/lib/radar/anomalies"
import { getSessionUser } from "@/lib/auth/session"
import { landingPathFor } from "@/lib/auth/role"

import "./landing.css"

export const dynamic = "force-dynamic"

/**
 * Radar's public marketing surface, and the root path.
 *
 * It renders for everyone, signed in or not: the page is not a redirect target
 * any more, so a signed-in visitor can open it to read the copy, fetch the
 * `curl`, or follow it to the public rankings exactly like anyone else. The
 * session changes only the header's account action — "登录" into `/sign-in` when
 * anonymous, "进入控制台" to the console the role owns (`landingPathFor`) when
 * signed in. An expired cookie resolves to no user and therefore to the sign-in
 * case, which is right: there is nobody to enter as.
 *
 * The body is a centred hero, a copyable `curl` for agents, and entry points
 * into the public rankings, category and detail pages. Those three are
 * anonymous and readable without an account
 * (docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.9.4).
 */
export default async function Home() {
  const user = await getSessionUser()

  // The Hero's copyable `curl` has to name a host the visitor can actually
  // reach, which is this deployment's own origin rather than the canonical one
  // in `metadataBase` — a preview deployment would otherwise hand out a command
  // pointing at production. Read from the request because the page is already
  // `force-dynamic`, so this costs no extra dynamic rendering.
  const requestHeaders = await headers()
  const host = requestHeaders.get("host")
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https"
  const origin = host ? `${proto}://${host}` : SITE_ORIGIN

  // The hero's live feed (§5.9.4). Fetched on the server so the rows are in the
  // first paint rather than arriving after hydration — the feed's whole argument
  // is "this is what we are seeing right now", and a feed that appears a second
  // later reads as a demo that was populated on load rather than as a signal.
  //
  // Failing to read it must not fail the page. The feed is the first screen, but
  // the rest of the landing page is copy that does not depend on it, and a
  // database blip is not a reason to 500 the marketing site.
  const anomalies = await listOpenAnomalies(db, { limit: 6 }).catch(() => [])

  // §5.9.4 要求 hero 的 feed 标注采集时间。在服务端算一次、以字符串传下去：
  // `Hero` 是 client 组件，让它自己 `new Date()` 会在服务端和客户端各算一次、
  // 差几秒，触发 hydration mismatch。
  const collectedAt = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  })

  // An empty feed is a state, not a gap: `Hero` renders nothing in its place and
  // `AnomalyQuietNote` states the reason one band lower ("these repos are
  // healthy"), because an empty box inside the hero reads as a failed load.

  return (
    <div className="landing-shell relative min-h-dvh overflow-x-clip">
      {/* Without this the page is mostly blank: the server renders every
          [data-reveal] block hidden so the first client render can match it
          (see use-reveal.tsx), which means the reveal animation is now what
          makes the content appear at all. A <noscript> style is the one place
          that can undo it — inside it, and only inside it, the rules apply. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      {/* The announce bar belongs to this page alone: it advertises the report
          the hero below offers, and every other page shares the nav instead of
          the campaign that sits above it. It comes before the nav rather than
          after so it scrolls away and leaves the sticky bar behind, which is
          what the nav's own `top-0` assumes. */}
      <AnnounceBar />
      <SiteNav cta={{ href: landingPathFor(user), signedIn: user !== null }} />
      <main>
        <Hero origin={origin} anomalies={anomalies} collectedAt={collectedAt} />
        {anomalies.length === 0 ? <AnomalyQuietNote /> : null}
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
  title: `${SITE_NAME} — 开源项目异动监控`,
  description:
    "记录每个 stargazer 的到达时间，据此判断一个开源项目正在变好还是变坏。每条结论可点开看原始时间轴。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_CN",
    title: `${SITE_NAME} — 开源项目异动监控`,
    description: "别人告诉你这个项目多受欢迎，我告诉你它正在变好还是变坏。",
    url: SITE_ORIGIN,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
}
