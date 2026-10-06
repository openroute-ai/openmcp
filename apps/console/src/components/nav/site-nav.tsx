"use client"

import { useState } from "react"
import { IconChevronDown, IconMenu, IconX } from "@tabler/icons-react"

import { RadarLogo } from "@/components/brand/radar-logo"
import { ThemeToggle } from "@/components/landing/theme"
import { LocaleLink } from "@/i18n/navigation"
import { SITE_HOST, SITE_NAME } from "@/lib/config/site"
import type { PublicRoutePath, RoutePath } from "@/lib/routes"

import { NavLink } from "./nav-link"

/**
 * The destinations a visitor actually has: the anomaly feed, the two rankings,
 * the project catalog, the category index and the API reference. They are routes
 * rather than `#anchors` because all six are real pages that stand on their own —
 * they are public and readable without an account, and are linked from shared
 * articles and by agents. Anchoring the nav into the landing page's own sections
 * would have left it dead everywhere else, which is why the list is route-typed
 * and the landing page is not in it.
 *
 * The order is the argument: this site reports declines, so the feed of things
 * going wrong is the first thing in the nav. Putting it after the rankings would
 * make the rankings the product's face, and a site whose front page is a
 * leaderboard is a site that only reports growth.
 *
 * `API 文档` is here because a JSON endpoint is a product surface too: the four
 * anonymous endpoints under it are how an agent or a script reads this site at
 * all, and burying that behind the footer put it one click below the pages that
 * depend on it. The page itself links onward to the long-form reference on the
 * documentation host for everything that needs a credential, so this link is the
 * single front door rather than a second place to keep in sync.
 */
const NAV_LINKS: { label: string; href: PublicRoutePath }[] = [
  { label: "异动", href: "/anomalies" },
  { label: "公开榜单", href: "/rankings" },
  { label: "飙升榜", href: "/rankings/rising" },
  { label: "项目库", href: "/projects" },
  { label: "分类", href: "/categories" },
  { label: "API 文档", href: "/docs" },
]

/**
 * The wordmark, which is also the way home from every page.
 *
 * It links to `/` rather than to the landing page's `#top` anchor: that anchor
 * exists on no other route, so on a rankings page the click would resolve to
 * nothing and only decorate the URL.
 */
function Logo() {
  return (
    <LocaleLink
      href="/"
      className="flex shrink-0 items-center gap-2.5"
      aria-label={SITE_NAME}
    >
      <RadarLogo className="size-6" />
      <span className="font-display text-base font-semibold tracking-tight">
        {SITE_NAME}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:block">
        {SITE_HOST}
      </span>
    </LocaleLink>
  )
}

interface SiteNavProps {
  /**
   * The account action in the nav, already resolved on the server.
   *
   * It is a prop rather than something this component derives because every
   * surface that renders this bar serves signed-in and anonymous visitors alike,
   * and this is a client component that cannot read a session. The two answers
   * differ in destination *and* label, so both arrive together: an anonymous
   * visitor gets "登录" pointing at `/sign-in`, a signed-in one gets "进入控制台"
   * pointing at their console. An expired cookie resolves to no user and
   * therefore to the ordinary sign-in case, which is correct — there is nobody
   * to enter as.
   */
  cta: { href: RoutePath; signedIn: boolean }
}

/**
 * The site's one navigation bar: the landing page and every public page under
 * it render this same component.
 *
 * It used to be two. The landing had one and `PublicShell` had another, with the
 * same five destinations, a smaller mark on one, icons on one bar and not the
 * other, pills on one and full-contrast text on the other, and a "返回首页"
 * button that only made sense on the pages the landing was not. Following one of
 * the two bars to the other gave away that they were the same site, and the
 * reader had to learn its navigation twice to get from one to the other.
 *
 * The landing's version won because it is the one that has to work for a
 * first-time visitor: no icons to decode, and a mobile menu. So this is that
 * markup, with the account action kept as a prop.
 *
 * No banner here. The announce bar is a campaign for the landing page's own copy
 * — the report its hero offers — and repeating it above the rankings would put an
 * ad for a download on a page about which repositories are declining. It is
 * rendered by the landing page instead (`landing/announce-bar.tsx`), so "home
 * only" is a property of where it is placed rather than a flag a caller can
 * leave on.
 */
export function SiteNav({ cta }: SiteNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const ctaLabel = cta.signedIn ? "进入控制台" : "登录"

  return (
    /**
     * Sticky rather than absolute, and frosted at every scroll position instead
     * of only once the page has moved: the bar is the one piece of chrome that
     * has to stay legible while the content scrolls under it, and a nav that
     * only turns opaque after 12px spends that first screen at its least
     * readable. `bg-background/70` over `backdrop-blur-xl` is the glass — the
     * alpha is what lets the content behind show through blurred rather than
     * simply being covered.
     */
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.href}
              href={link.href}
              // The current page is the one link that is not muted: the rest of
              // the bar is secondary chrome, and dimming the link you clicked is
              // how a nav loses track of where you are.
              activeClassName="font-medium text-foreground"
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex">
          <ThemeToggle />
          <LocaleLink
            href={cta.href}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            {ctaLabel}
          </LocaleLink>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
          <button
            type="button"
            aria-label="打开菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-lg border border-border bg-card text-foreground"
          >
            {menuOpen ? <IconX size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-border bg-background/80 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto grid max-w-6xl gap-1 px-4 py-4 text-sm">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                activeClassName="bg-card text-foreground"
                className="flex items-center justify-between rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                {link.label}
                <IconChevronDown size={14} className="-rotate-90 opacity-50" />
              </NavLink>
            ))}
            <LocaleLink
              href={cta.href}
              onClick={() => setMenuOpen(false)}
              className="mt-2 rounded-lg border border-border px-4 py-2.5 text-center font-medium text-foreground transition-colors hover:bg-card"
            >
              {ctaLabel}
            </LocaleLink>
          </nav>
        </div>
      )}
    </header>
  )
}
