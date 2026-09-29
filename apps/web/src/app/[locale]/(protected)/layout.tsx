import type { PropsWithChildren } from 'react'
import { SidebarProvider } from '@workspace/ui/components/sidebar'
import { requireAuth } from '@/lib/server/auth-utils'
import { Routes } from '@/lib/routes'

/**
 * Base layout for protected (authenticated) areas.
 *
 * The proxy already redirects signed-out visitors before a protected page is
 * streamed, but it can only see whether a session cookie is present. Resolving
 * the session here as well means a stale or forged cookie cannot render any
 * protected markup.
 *
 * Each area (user console / admin) provides its own sidebar and inset.
 */
export default async function ProtectedLayout({ children }: PropsWithChildren) {
  await requireAuth(Routes.Login)

  return <SidebarProvider>{children}</SidebarProvider>
}
