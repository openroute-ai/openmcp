"use client"

import * as React from "react"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"

import { NavMain } from "@/components/nav-main"
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

const data = {
  navMain: [
    {
      title: "Overview",
      url: "/dashboard",
      icon: <IconDashboard />,
    },
    {
      title: "Rankings",
      url: "/dashboard/rankings",
      icon: <IconChartBar />,
    },
    {
      title: "Tasks",
      url: "/dashboard/tasks",
      icon: <IconClock />,
    },
    {
      title: "Projects",
      url: "/dashboard/projects",
      icon: <IconFolder />,
    },
    {
      title: "Skills",
      url: "/dashboard/skills",
      icon: <IconRobot />,
    },
    {
      title: "Sync Jobs",
      url: "/dashboard/sync",
      icon: <IconRepeat />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession()

  const user = {
    name: session?.user?.name ?? "Signed out",
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
              <Link href="/dashboard">
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">Console</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
