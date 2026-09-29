import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'

/**
 * Server-side session guards.
 *
 * The proxy in `src/proxy.ts` is the first line of defence and redirects before
 * a protected page is ever streamed, but it can only inspect the presence of a
 * session cookie. These helpers ask better-auth whether the session is actually
 * valid, so a stale or forged cookie cannot render protected pages.
 *
 * The proxy is also what attaches `callbackUrl`, so these guards only need to
 * send the visitor to the sign-in page.
 */

/** Resolves the current session, or `null` when signed out. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

/** Redirects to sign-in when there is no valid session. */
export async function requireAuth(redirectHref: string = Routes.Login): Promise<undefined> {
  const session = await getSession()
  if (session == null) redirect(redirectHref)
}

/** Redirects away from auth pages when a valid session already exists. */
export async function requireUnauth(redirectHref: string = Routes.Dashboard): Promise<undefined> {
  const session = await getSession()
  if (session != null) redirect(redirectHref)
}
