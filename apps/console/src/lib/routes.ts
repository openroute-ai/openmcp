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
