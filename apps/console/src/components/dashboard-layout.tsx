import { getTranslations } from "next-intl/server"
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
 * A message path, so the header and the sidebar cannot drift apart. Typed as a
 * union of the paths that exist, so a page naming a message that does not
 * fails the build instead of rendering the key on the page.
 */
export type TitleKey = LeafKeys<Messages>

export async function DashboardLayout({
  titleKey,
  children,
}: {
  /** A message path, so the header and the sidebar cannot drift apart. */
  titleKey: TitleKey
  children: ReactNode
}) {
  const t = await getTranslations()
  const title = t(titleKey)
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title={title} />
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
