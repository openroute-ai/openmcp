import {
  IconArrowLeft,
  IconChartBar,
  IconHelpCircle,
  IconTags,
} from "@tabler/icons-react"

import { ThemeToggle } from "@/components/landing/theme"
import { LocaleLink } from "@/i18n/navigation"

/**
 * The chrome around the three public radar pages: rankings, categories, detail.
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

const NAV = [
  { href: "/rankings", label: "公开榜单", icon: IconChartBar },
  { href: "/categories", label: "应用分类", icon: IconTags },
  { href: "/faq", label: "常见问题", icon: IconHelpCircle },
] as const

function PublicHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <LocaleLink
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            R
          </span>
          <span className="hidden sm:inline">OpenMCP 雷达</span>
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
        <span>OpenMCP 雷达 — 榜单、分类、详情全部免费公开</span>
        <span>无自定义评分公式 · 无 AI 判定</span>
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
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
