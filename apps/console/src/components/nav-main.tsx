"use client"

import { useTranslations } from "next-intl"
import { LocaleLink } from "@/i18n/navigation"
import type { defaultMessages } from "@/i18n/messages"
import { Button } from "@workspace/ui/components/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { IconCirclePlusFilled, IconMail } from "@tabler/icons-react"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"

/** A key of the `Nav` messages, so a missing label fails the build. */
export type NavKey = keyof (typeof defaultMessages)["Nav"]

export function NavMain({
  items,
}: {
  items: {
    key: NavKey
    url: string
    icon?: React.ReactNode
  }[]
}) {
  const t = useTranslations("Nav")

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
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
            <Button
              size="icon"
              className="size-8 group-data-[collapsible=icon]:opacity-0"
              variant="outline"
            >
              <IconMail />
              <span className="sr-only">{t("inbox")}</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
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
