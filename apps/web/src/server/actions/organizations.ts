'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'

/**
 * Server surface of the `organization` plugin.
 *
 * The plugin is registered in `lib/auth.ts`, but `createAuth` types the plugin
 * list as `BetterAuthOptions['plugins']` so the phone plugin's inferred return
 * type (which reaches into zod v4 internals) stays out of the package's exported
 * signature. That widening is what erases the plugin's endpoints from
 * `auth.api`, so this narrows the one call site back to the documented body
 * shape rather than leaving the call untyped.
 *
 * https://www.better-auth.com/docs/plugins/organization#accepting-an-invitation
 */
type OrganizationApi = {
  acceptInvitation(input: {
    body: { invitationId: string }
    headers: Headers
  }): Promise<unknown>
}

/**
 * Accepts a pending organization invitation on behalf of the signed-in user.
 *
 * A server action rather than an `authClient.organization` call, because
 * acceptance requires a session and the plugin's client proxy widens
 * `authClient`'s type to Better Auth internals that cannot be named for
 * declaration emit. Every authoritative check — expiry, status, and that the
 * signed-in address matches the invitee — happens inside the plugin.
 */
export async function acceptInvitationAction(
  invitationId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const id = invitationId.trim()
  if (!id) {
    return { success: false, error: 'Invitation id is missing' }
  }

  try {
    const api = auth.api as unknown as OrganizationApi
    await api.acceptInvitation({ body: { invitationId: id }, headers: await headers() })

    // Membership changed, so any server-rendered organization list is stale.
    revalidatePath(Routes.Dashboard)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to accept the invitation',
    }
  }
}
