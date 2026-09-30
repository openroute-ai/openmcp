/**
 * Who a signed-in account is allowed to be.
 *
 * The console serves two audiences from one deployment, and the difference is
 * the account's role:
 *
 * - an **admin** curates the catalogue — projects, tags, skills, rankings, the
 *   task schedule — from `/dashboard`;
 * - anyone else signed in gets `/console`, which is the repository list and
 *   nothing else.
 *
 * The role is a column on `user` (`src/db/schema.ts`), matching the shared
 * schema, and Better Auth carries it on the session through
 * `user.additionalFields`. `apps/web` reads the same column, so promoting an
 * account is one row update rather than a per-app list.
 *
 * Everything here is a pure function over a role-bearing object, with no import
 * from the auth instance: the layouts, the tRPC procedures and the sign-in forms
 * all need the same answer, and a client component cannot import the server
 * auth. That is also why the parameter is structural rather than the inferred
 * session user — a session user, a database row and a sign-in response are three
 * different types carrying the same one field.
 */

import { Routes, type RoutePath } from "@/lib/routes"

/** The role an account must carry to reach `/dashboard`. */
export const ADMIN_ROLE = "admin"

/** What every role check accepts, whichever source the user came from. */
export interface RoleBearing {
  role?: string | null
}

/**
 * Whether the account may use the operator console.
 *
 * An exact match, and nothing looser: a null role, a missing column, a role
 * string this version has never heard of and a role with different casing all
 * mean "not an admin". Fails closed on purpose — a gate that treats an
 * unrecognised role as an admin would turn a typo in a database update into
 * full access to every project, task and repository.
 */
export function isAdmin(user: RoleBearing | null | undefined): boolean {
  return user?.role === ADMIN_ROLE
}

/**
 * Where a signed-in account belongs.
 *
 * The single answer to "which console is this for", so the two layouts cannot
 * disagree about it: a layout that redirected somewhere other than
 * `landingPathFor` would send an account to a gate that sends it back, and the
 * symptom would be a redirect loop rather than a wrong page.
 *
 * No account at all lands on sign-in, which is what a stale session cookie
 * deserves. The proxy sends anonymous visitors there before any of this runs;
 * this covers the case where the cookie exists but the session behind it does
 * not.
 */
export function landingPathFor(
  user: RoleBearing | null | undefined
): RoutePath {
  if (!user) return Routes.signIn
  return isAdmin(user) ? Routes.dashboard : Routes.console
}
