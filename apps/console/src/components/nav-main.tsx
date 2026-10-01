"use client"

import { useTranslations } from "next-intl"
import { LocaleLink } from "@/i18n/navigation"
import type { defaultMessages } from "@/i18n/messages"
import { groupNavItems } from "@/lib/nav-groups"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"

/** A key of the `Nav` messages, so a missing label fails the build. */
export type NavKey = keyof (typeof defaultMessages)["Nav"]

export type NavMainItem = {
  key: NavKey
  url: string
  icon?: React.ReactNode
  /**
   * The heading this link sits under, itself a `NavKey` because it is a message
   * like any other. Links that share one are drawn together under it; a link
   * without a group is drawn on its own, which is how the user console's single
   * entry stays unlabelled rather than gaining a heading for itself.
   */
  group?: NavKey
}

export function NavMain({
  items,
  actions,
}: {
  items: NavMainItem[]
  /**
   * The one-off buttons above the links, such as the operator console's "quick
   * create". Passed in rather than imported, because what belongs there depends
   * on the audience: the user console has no create-project action, and a
   * sidebar that rendered one would offer a mutation the server refuses.
   */
  actions?: React.ReactNode
}) {
  const t = useTranslations("Nav")
  const groups = groupNavItems<NavKey, NavMainItem>(items)

  return (
    <>
      {actions ? (
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>{actions}</SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      {groups.map((group) => (
        // A heading may legitimately appear twice, since a group ends where the
        // next entry names a different one, so the first link under it is what
        // identifies this group: link keys are unique.
        <SidebarGroup key={group.items[0]!.key}>
          {group.group ? (
            <SidebarGroupLabel>{t(group.group)}</SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  {item.url && item.url !== "#" ? (
                    <SidebarMenuButton tooltip={t(item.key)} asChild>
                      <LocaleLink href={item.url}>
                        {item.icon}
                        <span>{t(item.key)}</span>
                      </LocaleLink>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton tooltip={t(item.key)}>
                      {item.icon}
                      <span>{t(item.key)}</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
