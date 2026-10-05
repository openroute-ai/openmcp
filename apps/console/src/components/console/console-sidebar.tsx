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
import {
  IconCode,
  IconKey,
  IconLink,
  IconScale,
  IconSettings,
  IconWebhook,
} from "@tabler/icons-react"
import { RadarLogo } from "@/components/brand/radar-logo"
import { SITE_NAME } from "@/lib/config/site"
// Ungrouped: these are the account's three pages, and a heading over them would
// either name the product ("Workspace") or repeat each page back at the reader,
// which is noise rather than navigation.
const navMain: NavMainItem[] = [
  { key: "repos", url: "/console", icon: <IconCode /> },
  { key: "decisions", url: "/console/decisions", icon: <IconScale /> },
  // After repos rather than after decisions, because a key's main use is
  // submitting repositories, and the four entries above are all "things you
  // made" while this is "the credential you use to make more of them".
  { key: "apiKeys", url: "/console/api-keys", icon: <IconKey /> },
  // After the key list, because this page does not hold a key: it holds the
  // short-lived codes that produce one, and a reader looking for the key is
  // looking at the row this one becomes.
  { key: "connections", url: "/console/connections", icon: <IconLink /> },
  // After the credential pages, because that is what a subscription consumes: it
  // pushes data to a callback URL you sign with a key from the page above. A
  // reader looking for either starts at the credential.
  { key: "subscriptions", url: "/console/subscriptions", icon: <IconWebhook /> },
  // Also in the account menu at the foot of the sidebar. Here as well because
  // it is per-account data like the other two, and that is what this list holds.
  { key: "settings", url: "/settings", icon: <IconSettings /> },
]

/**
 * The user console's sidebar: the repositories you added, your decision boards,
 * and your account settings.
 *
 * Ungrouped because all three are per-account data and nothing else is. The
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
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
