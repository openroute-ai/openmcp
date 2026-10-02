import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SidebarInset } from '@workspace/ui/components/sidebar'
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar'
import { auth } from '@/lib/auth'
import { Routes } from '@/lib/routes'

export const dynamic = 'force-dynamic'

/**
 * Layout for the admin console (`/admin/*`).
 *
 * The admin console is a separate surface from the user console: it has its own
 * sidebar (`type='admin'`) and its own route list (`adminRoutes` in
 * `lib/routes.ts`), so each side keeps its own navigation and its own gate.
 *
 * This layout is the gate. A signed-in non-admin who reaches `/admin` by typing
 * the URL is sent to the dashboard rather than shown a console whose every
 * query 401s.
 *
 * This is UX, not authorization: `adminProcedure` re-checks the role on every
 * procedure, so skipping this redirect could not leak data.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  const role = session?.user ? (session.user as { role?: unknown }).role : undefined

  if (!session?.user) {
    redirect(Routes.Login)
  }

  if (role !== 'admin' && role !== 'super_admin') {
    redirect(Routes.Dashboard)
  }

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
