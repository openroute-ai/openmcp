import { Suspense, type PropsWithChildren } from 'react'
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar'
import { SidebarInset } from '@workspace/ui/components/sidebar'

/**
 * Layout for the user console (`/dashboard`, `/settings`, `/guide`, ...).
 *
 * Renders the user sidebar (user menu only) on the left.
 */
export default function ConsoleLayout({ children }: PropsWithChildren) {
  return (
    <>
      {/* The sidebar reads `?section=` to highlight the active settings tab, so it
          needs a boundary of its own to stay out of the static prerender. */}
      <Suspense fallback={null}>
        <DashboardSidebar variant='inset' type='user' />
      </Suspense>

      <SidebarInset>
        <main className='flex-1 overflow-auto'>{children}</main>
      </SidebarInset>
    </>
  )
}
