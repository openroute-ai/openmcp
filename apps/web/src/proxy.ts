import createMiddleware from "next-intl/middleware"
import { NextResponse, type NextRequest } from "next/server"
import { routing, type Locale } from "@/i18n/routing"
import { Routes, protectedRoutes, routesNotAllowedByLoggedInUsers } from "@/lib/routes"

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
const SIGN_UP_ROUTE = Routes.Register
const AUTH_ROUTES = [LOGIN_ROUTE, SIGN_UP_ROUTE]

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
 */
function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some((route) => {
    if (pathname === route) return true
    return pathname.startsWith(`${route}/`)
  })
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

  const isAuthRoute = routesNotAllowedByLoggedInUsers.some((route) => pathname === route)

  // The marketplace and marketing pages are public; only the routes listed in
  // `protectedRoutes` gate on a session.
  if (!isLoggedIn && isProtectedRoute(pathname)) {
    // Remember where the user was going so sign-in can return them there.
    const signInUrl = new URL(localize(LOGIN_ROUTE, locale), request.url)
    const callbackUrl = request.nextUrl.pathname + request.nextUrl.search
    signInUrl.searchParams.set("callbackUrl", callbackUrl)
    return NextResponse.redirect(signInUrl)
  }

  if (isLoggedIn && isAuthRoute) {
    return NextResponse.redirect(
      new URL(localize(Routes.Dashboard, locale), request.url)
    )
  }

  return null
}

export const config = {
  // Match all pathnames except:
  // - /api, /_next, /_vercel
  // - files with an extension (e.g. favicon.ico, robots.txt)
  matcher: [
    "/((?!api|trpc|_next|_vercel|.*\\.(?:ico|js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webmanifest|xml|txt)$).*)",
  ],
}
