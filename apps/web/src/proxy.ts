import createMiddleware from "next-intl/middleware"
import { NextResponse, type NextRequest } from "next/server"
import { routing, type Locale } from "@/i18n/routing"
import { Routes, matchesRoute, protectedRoutes } from "@/lib/routes"

/**
 * next-intl locale negotiation, combined with the auth gate.
 *
 * The app uses `localePrefix: 'as-needed'`, so the default locale renders at
 * the bare path (`/dashboard`) and other locales are prefixed (`/zh/dashboard`).
 *
 * https://next-intl.dev/docs/routing#base-path
 */
const handleI18nRouting = createMiddleware(routing)

const LOGIN_ROUTE = Routes.Login

/** Strips a leading locale segment, e.g. `/zh/dashboard` -> `/dashboard`. */
function splitLocale(pathname: string): { locale: Locale; pathname: string } {
  const [, maybeLocale, ...rest] = pathname.split("/")
  if (maybeLocale && (routing.locales as readonly string[]).includes(maybeLocale)) {
    return { locale: maybeLocale as Locale, pathname: `/${rest.join("/")}` }
  }
  return { locale: routing.defaultLocale, pathname }
}

/** Rebuilds a path with its locale prefix, respecting `as-needed`. */
function localize(pathname: string, locale: Locale): string {
  return locale === routing.defaultLocale ? pathname : `/${locale}${pathname}`
}

/**
 * True when `pathname` is, or lives under, a protected route. Compared on path
 * segments so `/admin/users` matches `/admin/users` and `/admin/users/42` but
 * not `/admin/users-archive`.
 *
 * Admin routes are part of `protectedRoutes`, so the signed-out redirect below
 * covers them too. The role check for `/admin/*` cannot happen here: the proxy
 * only sees cookie presence, not the session's role. That lives in the `/admin`
 * layout, which resolves the session and redirects non-admins to the dashboard.
 */
function isProtectedRoute(pathname: string): boolean {
  return matchesRoute(pathname, protectedRoutes)
}

export default function proxy(request: NextRequest) {
  const response = runAuthChecks(request)
  if (response) return response

  return handleI18nRouting(request)
}

function runAuthChecks(request: NextRequest): NextResponse | null {
  const { locale, pathname } = splitLocale(request.nextUrl.pathname)
  const sessionCookie = request.cookies.get("better-auth.session_token")
  const isLoggedIn = !!sessionCookie

  // The marketplace and marketing pages are public; only the routes listed in
  // `protectedRoutes` gate on a session.
  if (!isLoggedIn && isProtectedRoute(pathname)) {
    // Remember where the user was going so sign-in can return them there.
    const signInUrl = new URL(localize(LOGIN_ROUTE, locale), request.url)
    const callbackUrl = request.nextUrl.pathname + request.nextUrl.search
    signInUrl.searchParams.set("callbackUrl", callbackUrl)
    return NextResponse.redirect(signInUrl)
  }

  // Deliberately NOT bouncing signed-in visitors off the auth pages here.
  // Cookie presence is not proof of a valid session, so a stale cookie would
  // make this redirect to the dashboard while `requireAuth` in the protected
  // layout bounced the very same request back to sign-in, looping forever.
  // The auth pages own that decision via `requireUnauth`, which validates the
  // session server-side and therefore agrees with the protected layout.

  return null
}

/**
 * A path the proxy must never see.
 *
 * `api`, `trpc` and the `_next`/`_vercel` prefixes are requests Next resolves
 * on its own. `.*\.[^./]+$` is the rest: any path whose last segment carries a
 * file extension — a shape, not a list of the files that happen to exist today.
 *
 * A list is how `/images/contact-wechat.webp` came to answer the image
 * optimizer with an HTML 404: `webp` was missing from it, so `intlMiddleware`
 * rewrote the asset to `/zh/images/contact-wechat.webp`, which has no file and
 * no page. The optimizer then reported `received null` content type, and every
 * `next/image` QR dialog on the marketing pages fell back to its placeholder.
 * Enumerating extensions means every new asset needs this file edited too.
 *
 * Excluded here:
 *   - the file-based metadata routes (`robots.ts`, `sitemap.ts`, `manifest.ts`)
 *     and any `*.txt`/`*.md` route handler: they live outside `[locale]`, so
 *     they have no locale spelling and no page to render, and `intlMiddleware`
 *     would rewrite them to a path that does not exist.
 *   - everything in `public/`: an image, a manifest or a logo must not be
 *     answered with a redirect to a locale-prefixed 404.
 *   - any future file-based route, which this way needs no edit here.
 *
 * The one thing this lets past the gate that is a page is a dotted last
 * segment; nothing in `Routes` has one, and the auth layouts
 * resolve the session server-side, so the gate is the outer of two doors.
 */
export const config = {
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\.[^./]+$).*)"],
}
