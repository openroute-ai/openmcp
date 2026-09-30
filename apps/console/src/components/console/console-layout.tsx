import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"
import { AppShell, type TitleKey } from "@/components/app-shell"
import { ConsoleSidebar } from "@/components/console/console-sidebar"

/**
 * The frame for a page of the user console.
 *
 * The sibling of `DashboardLayout`, and deliberately not a reuse of it: the two
 * differ in which sidebar they render, and the sidebar is the list of pages the
 * audience may reach, so it cannot be a parameter that a page passes by mistake.
 *
 * As on the operator side, the role check is the layout's job
 * (`app/[locale]/console/layout.tsx`) rather than this frame's.
 */
export async function ConsoleLayout({
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
    <AppShell sidebar={<ConsoleSidebar variant="inset" />} title={title}>
      {children}
    </AppShell>
  )
}
