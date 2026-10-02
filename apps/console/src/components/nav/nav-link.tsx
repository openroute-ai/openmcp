"use client"

import type { ReactNode } from "react"

import { LocaleLink, useLocalePathname } from "@/i18n/navigation"
import type { PublicRoutePath } from "@/lib/routes"

/**
 * A nav item that knows whether it is the current page.
 *
 * The nav is one list of five destinations, and it had no way to say which one
 * the reader is on: someone who followed "公开榜单" could not tell which of five
 * links had brought them here, and on the ranking pages there are four of them
 * plus the detail pages underneath. The highlight is the only affordance a nav
 * has for "you are here" — the browser's own URL bar is not it, since these
 * links are client-side navigations.
 *
 * The current path comes from next-intl's `usePathname` rather than Next's,
 * because that one strips the locale prefix: `/en/rankings` and `/rankings` are
 * the same page to the reader, and comparing raw pathnames would leave the
 * English nav permanently unhighlighted.
 *
 * A prefix match rather than equality, so `/rankings/rising` also lights up
 * "公开榜单" — which is what a reader expects from a section link, and is why
 * `/rankings/rising` is listed separately at all. The root is the exception:
 * `"/"` prefixes everything, so it matches only exactly.
 *
 * `activeClassName` rather than a baked-in style, because one nav highlights its
 * current page two ways: the desktop links turn to full-contrast text, and the
 * mobile menu — where the items are stacked rows rather than a row of words —
 * takes a `card` background so the current page survives the larger tap target.
 */
interface NavLinkProps {
  href: PublicRoutePath
  className?: string
  activeClassName?: string
  onClick?: () => void
  children: ReactNode
}

export function NavLink({
  href,
  className = "",
  activeClassName = "text-foreground",
  onClick,
  children,
}: NavLinkProps) {
  const pathname = useLocalePathname()
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <LocaleLink
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={active ? `${className} ${activeClassName}`.trim() : className}
    >
      {children}
    </LocaleLink>
  )
}
