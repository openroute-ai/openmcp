/**
 * Sets or changes the account password.
 *
 * Routed through better-auth's server API rather than `authClient` from the
 * browser, because the two accounts here need different endpoints:
 * `changePassword` compares against a current password, which an account created
 * by phone sign-in does not have, while `setPassword` is where such an account
 * gets one — and it is marked server-only, so there is no client call to make.
 *
 * `hasPassword` decides which, and it is passed in from the settings page rather
 * than recomputed here: both endpoints are safe to call either way (the second
 * answers `PASSWORD_ALREADY_SET`), and having one place that answers the
 * question is worth more than the branch.
 */
import { headers } from "next/headers"
import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { getSessionUser } from "@/lib/auth/session"

/** Matches better-auth's own default minimum, which `assertPasswordNotTooShort` enforces. */
const MIN_LENGTH = 8
const MAX_LENGTH = 128

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let currentPassword: string
  let newPassword: string
  let hasPassword: boolean
  try {
    const body = (await request.json()) as {
      currentPassword?: unknown
      newPassword?: unknown
      hasPassword?: unknown
    }
    currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : ""
    newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
    hasPassword = body.hasPassword === true
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 })
  }

  // `revokeOtherSessions`: a password change is what someone does *because* they
  // think it leaked. Leaving the old sessions alive would answer that worry with
  // the opposite of what was asked.
  try {
    if (hasPassword) {
      await auth.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: await headers(),
      })
    } else {
      await auth.api.setPassword({
        body: { newPassword },
        headers: await headers(),
      })
    }
  } catch (error) {
    // better-auth's `APIError` carries the machine code one level down in
    // `body.code`; the top-level object only has `status`, `statusCode` and the
    // derived `message`.
    const body =
      typeof error === "object" && error !== null && "body" in error
        ? (error as { body?: { code?: unknown; message?: unknown } }).body
        : undefined
    const code = String(body?.code ?? "")
    const message = String(body?.message ?? "")

    if (code === "INVALID_PASSWORD" || code === "INVALID_CURRENT_PASSWORD") {
      return NextResponse.json({ error: "wrong_password" }, { status: 400 })
    }
    if (code === "PASSWORD_ALREADY_SET") {
      return NextResponse.json({ error: "password_already_set" }, { status: 409 })
    }

    console.error("[console] password change failed:", error)
    return NextResponse.json(
      { error: "password_change_failed", detail: message },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
