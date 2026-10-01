"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { authClient } from "@/lib/auth-client"
import { LocaleLink } from "@/i18n/navigation"
import { NavMain, type NavMainItem } from "@/components/nav-main"
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
import { IconCode, IconInnerShadowTop, IconScale } from "@tabler/icons-react"

// No group: one entry under a heading of its own would be a heading that names
// the page it sits above, which is noise rather than navigation.
const navMain: NavMainItem[] = [
  { key: "repos", url: "/console", icon: <IconCode /> },
  { key: "decisions", url: "/console/decisions", icon: <IconScale /> },
]

/**
 * The user console's sidebar: the repositories you added, and your decision
 * boards.
 *
 * Two entries because both are per-account data and nothing else is. The
 * workbench is here rather than on the public site on purpose: a shortlist is a
 * private working document, and `decisions.*` is `protectedProcedure` with the
 * ownership filter in the query, so there is no public version of it to link to.
 *
 * It also has no `actions`, so the operator console's "quick create" cannot leak
 * into it: curating a project is an admin's job, and `projects.create` would
 * refuse the call anyway.
 */
export function ConsoleSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
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
              <LocaleLink href="/console">
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">{t("myRepos")}</span>
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
