/**
 * The paths this app gates on, in one place.
 *
 * Every gate — the proxy, the two layouts, the sign-in forms — has to name the
 * same three destinations, and a role check that sent an admin somewhere the
 * user check does not know about would be a redirect loop rather than a bug the
 * author would notice. So the paths live here and the role decides which one is
 * a landing.
 *
 * Locale prefixes are *not* applied here. `next-intl`'s `Link`, `redirect` and
 * `useRouter` add them, and the one caller that cannot use them (the proxy, which
 * runs before the locale is resolved) has its own `localize` helper, because a
 * redirect built with the wrong locale would drop a `/zh` visitor onto English.
 */

import { LOCALES } from "@/i18n/routing"

/** The public landing page at the root, served to everyone. */
export const Routes = {
  root: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  /** The operator console: overview, tasks, projects, rankings, sync. */
  dashboard: "/dashboard",
  /** The user console: the dashboard, then the repository list under it. */
  console: "/console",
  /**
   * The decision workbench.
   *
   * Listed separately from `console` rather than folded into it: `isPublicPath`
   * prefix-matches these, and folding a gated path under the public console's
   * string would make the check read as though `/console` covered everything
   * underneath it.
   */
  decisions: "/console/decisions",
  /**
   * Account settings: avatar, name, email, phone number, password.
   *
   * One per console rather than one shared top-level path. A single `/settings`
   * could not have lived under either console — each console layout sends the
   * other role away — so it was a top-level path gated by a layout of its own,
   * and a page with a layout of its own is a page with no sidebar: its only way
   * out was a "back to console" link, while the way in was one of the two
   * sidebars' own rows. A settings page is per-account data like every other
   * row in those sidebars, so it belongs in both of them, and each console's
   * layout is already the gate that keeps the two apart. The content is one
   * component (`components/settings/settings-content.tsx`); only the frame and
   * the path differ.
   */
  consoleSettings: "/console/settings",
  dashboardSettings: "/dashboard/settings",
  /**
   * The caller's own billing page: subscription status, renew, and payment history.
   *
   * Listed beside `consoleSettings` because it is the same shape of page — per-account
   * data under `/console`, distinct from the operator's whole-ledger `/dashboard/billing`.
   */
  consoleBilling: "/console/billing",
} as const

export type RoutePath = (typeof Routes)[keyof typeof Routes]

/**
 * The radar's public surface: readable with no session, by anyone.
 *
 * These are the pages a crawler, a link in a chat, or an agent fetching a URL
 * has to be able to reach without an account. The proxy gates everything that is
 * not a sign-in route, so without an exception here each of them would answer a
 * 307 to `/sign-in` — which for a fetch is an HTML login page where JSON was
 * promised, and for a crawler is an empty index.
 *
 * The landing page is on the list because it is the acquisition surface the
 * rest of this set is reached from: `docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md`
 * §5.9.4 makes it the SEO hook. It is served to everyone, signed in or not —
 * leaving it out meant the branch was unreachable and the header's own links
 * resolved to a login form.
 *
 * The public JSON API under `/api` needs no entry: the proxy's matcher already
 * excludes `api`, so those were always reachable.
 */
export const PublicRoutes = {
  /** The landing page itself. Anonymous by design — see the note below. */
  landing: "/",
  /** The week / month / rising-stars rankings, with a `range` query. */
  rankings: "/rankings",
  /**
   * The rising-stars board, as its own entry.
   *
   * `isPublicPath` already covers it by prefix under `rankings`, so this adds no
   * access; it is here because the header links to it as a destination of its
   * own, and a nav typed against this list cannot name a path the list does not
   * have.
   */
  rising: "/rankings/rising",
  /** Tag navigation, and one tag's projects. */
  categories: "/categories",
  /** A single project's public detail, by id. */
  project: "/projects",
  /**
   * The exit ramp for external links.
   *
   * Every outbound link on the public pages points here first (see
   * `lib/outbound.ts`), so it has to be reachable without a session — a reader
   * who clicks "打开仓库" is not going to log in first. It is also deliberately
   * short: the route is a redirect endpoint, nothing renders.
   */
  out: "/out",
  /**
   * One author's page, by username.
   *
   * The detail page's byline links here, and the author page links back to the
   * projects list, so the pair is part of the same crawlable surface: an agent
   * that can reach a project must be able to reach the person behind it
   * without an account.
   */
  authors: "/authors",
  /**
   * The FAQ. A question often arrives before the product does — as a shared
   * link or a search result — so this one is a destination rather than a
   * section of the landing page, and it has to be readable without an account
   * for the same reason the other three are.
   */
  faq: "/faq",
  /**
   * The anomaly feed. Its own route rather than a rankings tab because §5.9.4
   * treats it as the product's front door: it is what makes the site legible as
   * a radar instead of a leaderboard, and a leaderboard is a page you visit once
   * while an anomaly feed is a page you come back to.
   */
  anomalies: "/anomalies",
  /**
   * The rest of the linked surface: the pages a shared link can point at.
   *
   * These are public for the same reason as the four above, and for one more:
   * the footer links to them, so gating any of them would turn every one of
   * those links into a redirect to a login form. `/blog` covers its posts by
   * the same prefix match.
   */
  method: "/method",
  guide: "/guide",
  docs: "/docs",
  about: "/about",
  contact: "/contact",
  blog: "/blog",
  privacy: "/privacy",
  terms: "/terms",
  security: "/security",
  license: "/license",
} as const

/**
 * One of the public surface's paths.
 *
 * Separate from {@link RoutePath} because the two sets are used by different
 * callers and conflating them would let a nav item point at a sign-in form:
 * `RoutePath` is what the gates and the post-login redirects name, while
 * everything a header links to comes from `PublicRoutes`.
 */
export type PublicRoutePath = (typeof PublicRoutes)[keyof typeof PublicRoutes]

/**
 * True when a path is public, with or without a locale prefix.
 *
 * Prefix rather than exact match, because `/rankings` and `/categories` are
 * section roots with children, and `/projects` only ever has an id segment.
 * That is safe without a trailing-separator check only because no gated route
 * starts with one of these strings: `/projects` is the sole `/projects*` path
 * and the console's own list lives at `/console`.
 *
 * The locale segment is stripped here rather than by the caller because the
 * caller's `detectLocalePrefix` reports `null` for the *default* locale — it
 * has to, so that `localize` does not add a prefix nobody asked for — which
 * leaves `/zh/rankings` looking like an unprefixed path. Matching on that would
 * gate the prefixed spelling of every public page, and the prefix is what a
 * visitor who picked a language arrives with.
 */
export function isPublicPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname)
  return Object.values(PublicRoutes).some(
    (route) => path === route || path.startsWith(`${route}/`)
  )
}

/** `/zh/rankings` -> `/rankings`; a path with no locale segment is unchanged. */
function stripLocalePrefix(pathname: string): string {
  for (const locale of LOCALES) {
    if (pathname === `/${locale}`) return "/"
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1)
    }
  }
  return pathname
}
