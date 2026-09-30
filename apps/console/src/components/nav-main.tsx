"use client"

import { useTranslations } from "next-intl"
import { LocaleLink } from "@/i18n/navigation"
import type { defaultMessages } from "@/i18n/messages"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"

/** A key of the `Nav` messages, so a missing label fails the build. */
export type NavKey = keyof (typeof defaultMessages)["Nav"]

export function NavMain({
  items,
  actions,
}: {
  items: {
    key: NavKey
    url: string
    icon?: React.ReactNode
  }[]
  /**
   * The one-off buttons above the links, such as the operator console's "quick
   * create". Passed in rather than imported, because what belongs there depends
   * on the audience: the user console has no create-project action, and a
   * sidebar that rendered one would offer a mutation the server refuses.
   */
  actions?: React.ReactNode
}) {
  const t = useTranslations("Nav")

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        {actions ? (
          <SidebarMenu>
            <SidebarMenuItem>{actions}</SidebarMenuItem>
          </SidebarMenu>
        ) : null}
        <SidebarMenu>
          {items.map((item) => (
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
  )
}
