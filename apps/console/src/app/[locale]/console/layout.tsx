import { getSessionUser, redirectTo } from "@/lib/auth/session"
import { isAdmin } from "@/lib/auth/role"
import { Routes } from "@/lib/routes"

export const dynamic = "force-dynamic"

/**
 * The gate on the user console.
 *
 * The mirror of `/dashboard`'s: an admin here belongs in the operator console,
 * and is sent there. Between the two layouts every signed-in account has exactly
 * one reachable console, which is what keeps them from bouncing — each gate
 * answers with `landingPathFor`'s other branch, never with itself.
 *
 * As on the dashboard side this is UX, not authorization. What a signed-in
 * account may actually reach is decided per procedure: `repos.list` and
 * `repos.create` are `protectedProcedure`, and every other router is
 * `adminProcedure`, so reaching this path by typing it gains nothing.
 */
export default async function ConsoleGate({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()

  if (!user) {
    await redirectTo(Routes.signIn)
  }

  if (isAdmin(user)) {
    await redirectTo(Routes.dashboard)
  }

  return children
}
