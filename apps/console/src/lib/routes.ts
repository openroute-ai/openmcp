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

/** The root, which resolves the landing path from the session's role. */
export const Routes = {
  root: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  /** The operator console: overview, tasks, projects, rankings, sync. */
  dashboard: "/dashboard",
  /** The user console: the repository list, and nothing else. */
  console: "/console",
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
 * The public JSON API under `/api` needs no entry: the proxy's matcher already
 * excludes `api`, so those were always reachable.
 *
 * Locale prefixes are not applied here, for the same reason as `Routes` above —
 * `isPublicPath` compares against a prefix-stripped path.
 */
export const PublicRoutes = {
  /** The week / month / rising-stars rankings, with a `range` query. */
  rankings: "/rankings",
  /** Tag navigation, and one tag's projects. */
  categories: "/categories",
  /** A single project's public detail, by id. */
  project: "/projects",
} as const

/**
 * True when a path — with any locale prefix already stripped — is public.
 *
 * Prefix rather than exact match, because `/rankings` and `/categories` are
 * section roots with children, and `/projects` only ever has an id segment.
 * That is safe without a trailing-separator check only because no gated route
 * starts with one of these strings: `/projects` is the sole `/projects*` path
 * and the console's own list lives at `/console`.
 */
export function isPublicPath(
  pathname: string,
  localePrefix: string | null
): boolean {
  const path = localePrefix ? `/${localePrefix}${pathname}` : pathname
  return Object.values(PublicRoutes).some(
    (route) => path === route || path.startsWith(`${route}/`)
  )
}
