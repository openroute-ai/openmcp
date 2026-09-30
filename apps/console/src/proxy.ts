import createIntlMiddleware from "next-intl/middleware"
import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

import { DEFAULT_LOCALE, LOCALES, routing } from "@/i18n/routing"
import { Routes } from "@/lib/routes"

const intlMiddleware = createIntlMiddleware(routing)

const AUTH_ROUTES = [Routes.signIn, Routes.signUp]

/**
 * Where an authenticated visitor lands.
 *
 * The root, not a console, because the proxy can only see that a session cookie
 * is *present* — reading the account behind it would mean a database round trip
 * on every request, and the cookie can be stale. The root resolves the session
 * and redirects on to the console that matches the account's role, so the
 * role-dependent half of this decision lives in one place
 * (`landingPathFor`) instead of being guessed at from a cookie.
 */
const DEFAULT_LANDING = Routes.root

/**
 * The request pipeline: authentication, then locale.
 *
 * The auth checks run first so a redirect can name the locale the visitor
 * arrived with; the intl middleware then rewrites what is left over.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = getSessionCookie(request)
  const localePrefix = detectLocalePrefix(pathname)
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => localize(route, localePrefix) === pathname
  )

  if (!sessionCookie && !isAuthRoute) {
    return NextResponse.redirect(
      new URL(localize(AUTH_ROUTES[0]!, localePrefix), request.url)
    )
  }

  if (sessionCookie && isAuthRoute) {
    return NextResponse.redirect(
      new URL(localize(DEFAULT_LANDING, localePrefix), request.url)
    )
  }

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

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
