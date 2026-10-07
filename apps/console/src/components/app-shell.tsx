import type { ReactNode } from "react"
import type { defaultMessages } from "@/i18n/messages"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

type Messages = typeof defaultMessages

/**
 * Every leaf path in the catalog, as dotted strings.
 *
 * Leaves only, because a path that stops at a group (`Tasks.column`) is not a
 * message and `t()` would reject it. Recursing keeps nested groups such as
 * `Rankings.column.rank` usable from a page.
 */
type LeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}`
}[keyof T & string]

/**
 * A message path, so the header, the sidebar and the document title cannot
 * drift apart. Typed as a union of the paths that exist, so a page naming a
 * message that does not fails the build instead of rendering the key on the
 * page.
 */
export type TitleKey = LeafKeys<Messages>

/**
 * The frame every console page renders inside: sidebar, header, and a padded
 * main column.
 *
 * Shared by the operator console and the user console because they are the same
 * page furniture with a different sidebar — the two differ in which links exist
 * and who may see them, not in how a row of a table sits on the page. Keeping
 * this in one place is what makes a change to the header land on both.
 *
 * `sidebar` is passed in rather than chosen here, because the choice is
 * authorization-flavoured: the two sidebars list different pages, and a console
 * that rendered the wrong one would offer links its own gate would bounce.
 */
export function AppShell({
  sidebar,
  title,
  badge,
  children,
}: {
  sidebar: ReactNode
  title: string
  /**
   * 页头右侧的状态标记。**只有用户控制台会传**（Pro 徽标）：运营控制台没有订阅，
   * 这条参数留空，页头回到它本来的样子。
   */
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      {sidebar}
      <SidebarInset>
        <SiteHeader title={title} badge={badge} />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">{children}</div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** The operator console's sidebar, which lists the pages behind `/dashboard`. */
export function DashboardSidebar() {
  return <AppSidebar variant="inset" />
}
