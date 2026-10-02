import {
  IconArrowLeft,
  IconChartBar,
  IconChartLine,
  IconRadar,
  IconTags,
} from "@tabler/icons-react"

import { SiteMark } from "@/components/brand/site-mark"
import { ThemeToggle } from "@/components/landing/theme"
import { LocaleLink } from "@/i18n/navigation"
import { SITE_NAME } from "@/lib/config/site"

/**
 * The chrome around the public radar pages: anomalies, the two rankings,
 * categories, detail, and the long-form pages that hang off the footer
 * (method, guide, docs, about, contact, blog and the four legal routes).
 *
 * Separate from the landing's `SiteHeader` because that one's links are anchors
 * into the marketing page's own sections (`#pricing`, `#method`). Reusing it here
 * would put a header full of links that resolve to nothing on every one of these
 * routes, which is worse than no header.
 *
 * Chinese only, like the rest of the public surface. These pages are reached by
 * shared links and by agents fetching a URL, not by a reader choosing a locale,
 * and the landing has no translated copy either — adding a `next-intl` namespace
 * to one of two Chinese surfaces would make the split worse, not better.
 */

/**
 * Anomalies first.
 *
 * The order is the argument: this site reports declines, so the feed of things
 * going wrong is the first thing in the nav. Putting it after the rankings would
 * make the rankings the product's face, and a site whose front page is a
 * leaderboard is a site that only reports growth.
 */
/**
 * The four destinations, and they are the same four the landing page's header
 * offers.
 *
 * Someone who follows one of these links lands on a page whose header shows the
 * same list, so the two bars read as one site instead of two. `常见问题` used to
 * be here and now lives in the footer: it is the one destination that arrives
 * after a reader has already decided they care, not one they use to get here.
 */
const NAV = [
  { href: "/anomalies", label: "异动", icon: IconRadar },
  { href: "/rankings", label: "公开榜单", icon: IconChartBar },
  { href: "/rankings/rising", label: "飙升榜", icon: IconChartLine },
  { href: "/categories", label: "分类", icon: IconTags },
] as const

function PublicHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <LocaleLink
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <SiteMark className="size-7 shrink-0" />
          <span className="hidden sm:inline">{SITE_NAME}</span>
        </LocaleLink>

        <nav className="flex items-center gap-1 text-sm">
          {NAV.map(({ href, label, icon: Icon }) => (
            <LocaleLink
              key={href}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon size={15} />
              {label}
            </LocaleLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <LocaleLink
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <IconArrowLeft size={15} />
            返回首页
          </LocaleLink>
        </div>
      </div>
    </header>
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
        <span>{SITE_NAME}</span>
        <span>数据每周更新</span>
      </div>
    </footer>
  )
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  )
}

/** The page heading every public page starts with. */
export function PublicPageHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="grid gap-3 border-b border-border pb-6">
      <div className="grid gap-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
