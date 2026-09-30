/**
 * Reading the session from a server component.
 *
 * `proxy.ts` can only see that a session *cookie* is present — it runs before
 * anything can validate it, and validating it there would mean a database round
 * trip on every asset request. So the two console layouts each resolve the
 * session themselves, and that is where the role decides which one renders.
 *
 * This module is server-only by construction: it reads request headers and
 * imports the auth instance, neither of which a client component may do.
 */

import { headers } from "next/headers"
import { getLocale } from "next-intl/server"

import { localeRedirect } from "@/i18n/navigation"
import { auth } from "@/lib/auth"
import type { RoleBearing } from "@/lib/auth/role"
import { type RoutePath } from "@/lib/routes"

/**
 * The signed-in account, or null.
 *
 * Null covers both "no session" and "a cookie whose session has expired", which
 * are the same thing to every caller: there is nobody to act as.
 */
export async function getSessionUser(): Promise<RoleBearing | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ?? null
}

/**
 * Redirects within the app, keeping the reader's locale.
 *
 * The plain `next/navigation` redirect would drop a `/zh` reader onto the
 * default locale, which is why the locale-aware one from `createNavigation` is
 * used. It requires the locale explicitly because the proxy — the one caller
 * that cannot know it — has its own `localize` helper instead.
 *
 * Async because next-intl reads the locale from a promise-resolved request
 * context. It is awaited at every call site: a redirect that is not awaited is
 * indistinguishable from no redirect at all until the microtask runs, which
 * would let the caller fall through to the page it was trying to leave.
 */
export async function redirectTo(href: RoutePath): Promise<void> {
  localeRedirect({ href, locale: await getLocale() })
}
