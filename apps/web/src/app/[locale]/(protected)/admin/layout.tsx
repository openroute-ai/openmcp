'use client'

import { SidebarInset } from '@workspace/ui/components/sidebar'
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar'

/**
 * Layout for the admin console (`/admin/*`).
 *
 * Renders the admin sidebar (admin menu only) on the left.
 *
 * No role check lives here: the proxy resolves the session for the whole
 * protected tree, and every admin procedure independently verifies the `admin`
 * role before touching data. Adding a redirect would duplicate that check and
 * would flash a redirect for role changes mid-session.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DashboardSidebar variant='inset' type='admin' />

      <SidebarInset>
        <main className='flex-1 overflow-auto'>
          <div className='flex flex-col gap-4 p-4'>{children}</div>
        </main>
      </SidebarInset>
    </>
  )
}
