"use client"

import { defineI18nUI } from "fumadocs-ui/i18n"
import { RootProvider } from "fumadocs-ui/provider/next"
import type { ReactNode } from "react"
import { i18n } from "@/lib/i18n"

const { provider } = defineI18nUI(i18n, {
  zh: {
    displayName: "简体中文",
    search: "搜索文档",
  },
  en: {
    displayName: "English",
    search: "Search",
  },
})

export function Provider({
  children,
  locale,
}: {
  children: ReactNode
  locale: string
}) {
  return (
    <RootProvider
      i18n={provider(locale)}
      search={{
        options: {
          api: "/api/search",
        },
      }}
    >
      {children}
    </RootProvider>
  )
}
