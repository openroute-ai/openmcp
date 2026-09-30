import { getSessionUser, redirectTo } from "@/lib/auth/session"
import { isAdmin } from "@/lib/auth/role"
import { Routes } from "@/lib/routes"

export const dynamic = "force-dynamic"

/**
 * The gate on the operator console.
 *
 * Everything under `/dashboard` curates the catalogue — projects, tags, skills,
 * rankings, the task schedule — and none of it is available to a signed-in
 * account without the `admin` role. A non-admin who reaches this path by typing
 * the URL is sent to `/console`, their own surface, rather than shown a console
 * whose every query would come back `FORBIDDEN`. An admin visiting `/console`
 * is sent here by that layout's own gate, which is what makes the two paths
 * exhaustive: every signed-in account has exactly one of them.
 *
 * **This is UX, not authorization.** A page can be reached without rendering its
 * layout — prefetched, fetched directly, or from a client-side navigation — so
 * every procedure behind this path is `adminProcedure` and re-checks the role.
 * Removing this file would make the console unusable for a non-admin; it could
 * not make it unsafe.
 */
export default async function DashboardGate({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()

  if (!user) {
    await redirectTo(Routes.signIn)
  }

  if (!isAdmin(user)) {
    await redirectTo(Routes.console)
  }

  return children
}
