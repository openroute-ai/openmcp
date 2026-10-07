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
  IconChartAreaLine,
  IconCode,
  IconKey,
  IconReceipt2,
  IconScale,
  IconSettings,
  IconWebhook,
} from "@tabler/icons-react"
import { RadarLogo } from "@/components/brand/radar-logo"
import { SITE_NAME } from "@/lib/config/site"

/**
 * This account's own settings page, named once.
 *
 * It is both a row of this sidebar and the settings entry in the account menu
 * at its foot, and the two have to agree.
 */
const SETTINGS_PATH = "/console/settings"

// Three groups, read top to bottom as the account works:
//
// - 概览 alone: it is where sign-in lands, so it answers "where does my account
//   stand" before anything else. Making it a heading of its own keeps it from
//   being read as one of the workbench pages below.
// - 工作台: the two places the account produces things (repositories, decisions).
// - 账户: the credentials it spends (API keys), what those consume (subscriptions,
//   billing), and where it manages itself (settings).
const navMain: NavMainItem[] = [
  {
    key: "dashboard",
    url: "/console",
    icon: <IconChartAreaLine />,
    group: "groupOverview",
  },
  { key: "repos", url: "/console/repos", icon: <IconCode />, group: "groupWorkbench" },
  {
    key: "decisions",
    url: "/console/decisions",
    icon: <IconScale />,
    group: "groupWorkbench",
  },
  { key: "apiKeys", url: "/console/api-keys", icon: <IconKey />, group: "groupAccount" },
  // After the credential pages, because that is what a subscription consumes: it
  // pushes data to a callback URL you sign with a key from the page above. A
  // reader looking for either starts at the credential.
  {
    key: "subscriptions",
    url: "/console/subscriptions",
    icon: <IconWebhook />,
    group: "groupAccount",
  },
  // Billing with the rest of the account group: it is the ledger of what the
  // subscription above pays for. A reader who comes from a price page wants the
  // "renew" button and the payment history, and both live here.
  {
    key: "billing",
    url: "/console/billing",
    icon: <IconReceipt2 />,
    group: "groupAccount",
  },
  // Also in the account menu at the foot of the sidebar. Here as well because
  // it is per-account data like the other two, and that is what this list holds.
  // Inside `/console` rather than a shared top-level `/settings`, so that
  // following it keeps this menu on screen — see `Routes.consoleSettings`.
  { key: "settings", url: SETTINGS_PATH, icon: <IconSettings />, group: "groupAccount" },
]

/**
 * The user console's sidebar: your dashboard, the repositories you added, your
 * decision boards, and your account settings.
 *
 * The dashboard stands alone so "where does my account stand" stays the first
 * row; the rest is grouped into the pages that produce work and the pages that
 * hold the account's credentials and records. All of these are per-account data
 * and nothing else is. The workbench is here rather than on the public site on
 * purpose: a shortlist is a private working document, and `decisions.*` is
 * `protectedProcedure` with the ownership filter in the query, so there is no
 * public version of it to link to.
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
        <NavUser user={user} settingsHref={SETTINGS_PATH} />
      </SidebarFooter>
    </Sidebar>
  )
}
