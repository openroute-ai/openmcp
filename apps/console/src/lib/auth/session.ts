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
import { landingPathFor, type RoleBearing } from "@/lib/auth/role"
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
 * The signed-in account with the fields account settings actually write.
 *
 * `getSessionUser` is deliberately structural — the gates only need `role`, and
 * widening it would make every layout depend on the shape of the user table. The
 * settings page and its routes are the opposite: they read and write `name`,
 * `email`, `image` and the two phone columns, so they ask for those explicitly
 * here rather than casting the narrow type at four call sites.
 *
 * Returns null both for "no session" and "expired session", as `getSessionUser`
 * does; the callers treat the two the same.
 */
export interface SessionUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  phoneNumber: string | null
  phoneNumberVerified: boolean
}

export async function getFullSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  const { user } = session
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    // Optional on better-auth's user type without the phone plugin; present as a
    // real column here (`src/db/schema.ts`), so a missing one is null rather
    // than a crash.
    phoneNumber: user.phoneNumber ?? null,
    phoneNumberVerified: user.phoneNumberVerified ?? false,
  }
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

/**
 * Sends a visitor who *is* signed in away from `/sign-in` and `/sign-up`.
 *
 * The proxy cannot do this: it sees that a session cookie is present, not that
 * the session behind it is valid, and bouncing on presence alone is what turned
 * an expired cookie into an endless `/sign-in` → `/` → `/sign-in` chain. Asking
 * better-auth settles it the same way the root and the two layouts settle it,
 * and `landingPathFor` keeps the destination consistent with theirs.
 *
 * The counterpart of the two gates: `getSessionUser` sends a visitor *without* a
 * session to the sign-in page, this sends one *with* a session to their console.
 */
export async function requireUnauth(): Promise<void> {
  const user = await getSessionUser()

  if (user) {
    await redirectTo(landingPathFor(user))
  }
}
