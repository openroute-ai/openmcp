import createIntlMiddleware from "next-intl/middleware"
import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

import { DEFAULT_LOCALE, LOCALES, routing } from "@/i18n/routing"
import { isPublicPath, Routes } from "@/lib/routes"

const intlMiddleware = createIntlMiddleware(routing)

const AUTH_ROUTES = [Routes.signIn, Routes.signUp]

/** True when the path is one of the auth pages, in any locale. */
function isAuthRoute(pathname: string, localePrefix: string | null): boolean {
  return AUTH_ROUTES.some((route) => localize(route, localePrefix) === pathname)
}

/**
 * The request pipeline: authentication, then locale.
 *
 * The auth check runs first so a redirect can name the locale the visitor
 * arrived with; the intl middleware then rewrites what is left over.
 *
 * A public path still falls through to `intlMiddleware`, not to a bare `NextResponse`:
 * the locale prefix has to be normalized for these routes too, or a visitor
 * without one would be served the wrong language's messages.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = getSessionCookie(request)
  const localePrefix = detectLocalePrefix(pathname)

  // The radar's public pages. Gating them would mean a shared link, a search
  // result, or an agent fetching a URL all land on a login page, so they are
  // the one non-auth path that passes through without a cookie.
  const needsAuth =
    !sessionCookie &&
    !isAuthRoute(pathname, localePrefix) &&
    !isPublicPath(pathname)

  if (needsAuth) {
    return NextResponse.redirect(
      new URL(localize(Routes.signIn, localePrefix), request.url)
    )
  }

  // Deliberately NOT bouncing a cookie-carrying visitor off the auth pages.
  // Cookie presence is not proof of a valid session: a stale cookie would send
  // `/sign-in` to the root, the root would resolve the session, find nobody and
  // send the very same request back to `/sign-in` — an endless redirect chain
  // (`ERR_TOO_MANY_REDIRECTS`) instead of a sign-in form. The auth pages own
  // that decision server-side via `requireUnauth`, which validates the session
  // and therefore agrees with what the layouts and the root would do.
  //
  // `apps/web` reached the same conclusion; see the note in its `src/proxy.ts`.
  return intlMiddleware(request)
}

/** The locale segment in a path, or null when it carries the default one. */
function detectLocalePrefix(pathname: string): string | null {
  const match = LOCALES.find(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
  )
  return match && match !== DEFAULT_LOCALE ? match : null
}

/** Prefixes a path only when the visitor is not on the default locale. */
function localize(path: string, localePrefix: string | null): string {
  return localePrefix ? `/${localePrefix}${path}` : path
}

/**
 * A path the proxy must never see.
 *
 * `api` and the three `_next` prefixes are requests Next resolves on its own.
 * `.*\.[^./]+$` is the rest: any path whose last segment carries a file
 * extension. That is not a guess about which files exist, it is the shape of
 * three kinds of route this app has, and the auth gate cannot be the thing that
 * decides whether they are reachable:
 *
 *   - `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts` and the two
 *     `llms*.txt` route handlers. They live *outside* `[locale]`, so they have
 *     no locale spelling and no page to render — `isPublicPath` cannot name them
 *     (it prefix-matches), and even if it did, `intlMiddleware` would rewrite
 *     `/llms.txt` to `/zh/llms.txt`, which does not exist.
 *   - Everything in `public/`. A crawler that followed the gate to
 *     `/sign-in` got an HTML login page where an image or a manifest was
 *     promised; so did every browser, which is why `/og.png` — the OG image of
 *     the landing page — and `/logo.svg` — a manifest icon — answered with a 307
 *     to a form.
 *   - Any future file-based route, which this way needs no edit here.
 *
 * The one thing it lets past the gate that is a page is a dotted last segment,
 * `/console/repos/vercel.ai`; nothing is reachable because of it. The console
 * layouts resolve the session server-side and every router procedure is
 * `protectedProcedure` or `adminProcedure`, so the gate was the outer of two
 * doors, not the only one.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.[^./]+$).*)"],
}
