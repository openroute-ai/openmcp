"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { authClient } from "@/lib/auth-client"
import { LocaleLink } from "@/i18n/navigation"
import { NavMain, type NavKey } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import {
  IconDashboard,
  IconChartBar,
  IconClock,
  IconFolder,
  IconRobot,
  IconRepeat,
  IconInnerShadowTop,
} from "@tabler/icons-react"

// The label is a message key rather than text, so the sidebar translates with
// everything else. The url stays here: it is routing, not presentation.
const navMain: { key: NavKey; url: string; icon: React.ReactNode }[] = [
  { key: "overview", url: "/dashboard", icon: <IconDashboard /> },
  { key: "rankings", url: "/dashboard/rankings", icon: <IconChartBar /> },
  { key: "tasks", url: "/dashboard/tasks", icon: <IconClock /> },
  { key: "projects", url: "/dashboard/projects", icon: <IconFolder /> },
  { key: "skills", url: "/dashboard/skills", icon: <IconRobot /> },
  { key: "syncJobs", url: "/dashboard/sync", icon: <IconRepeat /> },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const t = useTranslations("Nav")
  const { data: session } = authClient.useSession()

  const user = {
    name: session?.user?.name ?? t("signedOut"),
    email: session?.user?.email ?? "",
    avatar: session?.user?.image ?? "",
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <LocaleLink href="/dashboard">
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">{t("console")}</span>
              </LocaleLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
