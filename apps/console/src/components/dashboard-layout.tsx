import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"
import { AppShell, DashboardSidebar, type TitleKey } from "@/components/app-shell"

/**
 * The frame for a page of the operator console.
 *
 * The role check is not here: it is `app/[locale]/dashboard/layout.tsx`, which
 * every page under that path shares. A page that gated itself would be one more
 * place to forget.
 */
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
    <AppShell sidebar={<DashboardSidebar />} title={title}>
      {children}
    </AppShell>
  )
}
