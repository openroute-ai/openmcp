"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { authClient } from "@/lib/auth-client"
import { LocaleLink } from "@/i18n/navigation"
import { NavMain, type NavMainItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { IconCirclePlusFilled } from "@tabler/icons-react"
import {
  IconDashboard,
  IconChartBar,
  IconClock,
  IconCode,
  IconFolder,
  IconRobot,
  IconRepeat,
  IconUsers,
  IconUsersGroup,
  IconDeviceDesktop,
  IconKey,
  IconSettings,
} from "@tabler/icons-react"
import { RadarLogo } from "@/components/brand/radar-logo"
import { SITE_NAME } from "@/lib/config/site"

// The label is a message key rather than text, so the sidebar translates with
// everything else. The url stays here: it is routing, not presentation.
//
// The order is the one an operator works in, read top to bottom: what this
// deployment looks like, the catalog it serves, the jobs that fill it, and
// finally the accounts behind it. The groups are headings over that order, not
// a reordering of it — moving a link between two of them would move it in the
// eye's path as well, which is why the lists below are contiguous.
const navMain: NavMainItem[] = [
  {
    key: "overview",
    url: "/dashboard",
    icon: <IconDashboard />,
    group: "groupInsights",
  },
  {
    key: "rankings",
    url: "/dashboard/rankings",
    icon: <IconChartBar />,
    group: "groupInsights",
  },
  {
    key: "projects",
    url: "/dashboard/projects",
    icon: <IconFolder />,
    group: "groupCatalog",
  },
  // Authors sit next to projects rather than under them: an author outlives the
  // project that introduced them, and this is the only page that lists all of
  // them at once.
  {
    key: "authors",
    url: "/dashboard/authors",
    icon: <IconUsers />,
    group: "groupCatalog",
  },
  {
    key: "repos",
    url: "/dashboard/repos",
    icon: <IconCode />,
    group: "groupCatalog",
  },
  {
    key: "skills",
    url: "/dashboard/skills",
    icon: <IconRobot />,
    group: "groupCatalog",
  },
  {
    key: "tasks",
    url: "/dashboard/tasks",
    icon: <IconClock />,
    group: "groupOperations",
  },
  {
    key: "syncJobs",
    url: "/dashboard/sync",
    icon: <IconRepeat />,
    group: "groupOperations",
  },
  // Accounts and sessions come last: the entries above are about the catalog
  // this deployment builds, while these two are about the people using it, so
  // they stay out of the way until someone is looking for them.
  {
    key: "users",
    url: "/dashboard/users",
    icon: <IconUsersGroup />,
    group: "groupManagement",
  },
  {
    key: "sessions",
    url: "/dashboard/sessions",
    icon: <IconDeviceDesktop />,
    group: "groupManagement",
  },
  // Beside sessions rather than after users: both are per-account records, and
  // this is the page an operator opens when someone reports "my key stopped
  // working" or "I never got a key" — which is a lookup, so it belongs with the
  // other "look something up by account" page.
  {
    key: "apiKeys",
    url: "/dashboard/api-keys",
    icon: <IconKey />,
    group: "groupManagement",
  },
  // Last, because it is about the reader rather than about anyone else: the
  // rows above are the operator's view of other accounts, this one is the
  // operator's own.
  {
    key: "settings",
    url: "/settings",
    icon: <IconSettings />,
    group: "groupManagement",
  },
]

/**
 * The operator console's sidebar.
 *
 * Only ever rendered behind `/dashboard`, whose layout has already established
 * that the account is an admin, so the links here are links the account is
 * allowed to follow.
 */
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
              <LocaleLink
                href="/dashboard"
                className="flex items-center gap-2.5"
              >
                <RadarLogo className="size-6" />
                <span className="font-display text-base font-semibold tracking-tight">
                  {SITE_NAME}
                </span>
              </LocaleLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navMain}
          actions={
            <CreateProjectDialog
              trigger={
                <SidebarMenuButton
                  tooltip={t("quickCreate")}
                  className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                >
                  <IconCirclePlusFilled />
                  <span>{t("quickCreate")}</span>
                </SidebarMenuButton>
              }
            />
          }
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
