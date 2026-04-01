import { NextRequest, NextResponse } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  const { pathname } = request.nextUrl

  const isAuthRoute =
    pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")

  if (!sessionCookie && !isAuthRoute) {
    return NextResponse.redirect(new URL("/sign-in", request.url))
  }

  if (sessionCookie && isAuthRoute) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
