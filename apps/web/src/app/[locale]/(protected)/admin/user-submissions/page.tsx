import { redirect } from 'next/navigation'
import { Routes } from '@/lib/routes'

/**
 * Historical URL for the tabbed submissions hub.
 *
 * Provider applications, A2A agents and MCP servers each got their own sidebar
 * entry and page, so this aggregator has nothing left to aggregate. Keep the
 * route resolving (rather than 404ing) for anyone who still has the old link,
 * and send them to the first queue.
 */
export default function UserSubmissionsRedirect() {
  redirect(Routes.AdminProviderApplications)
}