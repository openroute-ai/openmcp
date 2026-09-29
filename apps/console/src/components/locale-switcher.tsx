"use client"

import { useLocale, useTranslations } from "next-intl"
import * as React from "react"
import { useTransition } from "react"
import { IconLanguage } from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useLocalePathname, useLocaleRouter } from "@/i18n/navigation"
import { i18n, type Locale } from "@/lib/config/i18n"

// Read from config once: the locale list cannot change at runtime, and a
// module-level array keeps it out of the component body.
const LOCALES = Object.keys(i18n.locales) as Locale[]

/**
 * Switches the interface language.
 *
 * The locale lives in the path, so switching re-navigates to the same page
 * under the new prefix rather than a bare locale change: the router is the
 * locale-aware one, so the prefix is handled without any string surgery here.
 *
 * https://next-intl.dev/docs/routing/navigation#userouter
 */
export function LocaleSwitcher() {
  const t = useTranslations("Common")
  const current = useLocale()
  const router = useLocaleRouter()
  const pathname = useLocalePathname()
  const [pending, startTransition] = useTransition()

  // With a single locale there is nothing to switch to, and a menu holding
  // one entry is just a dead control. After the hooks, so the hook order does
  // not depend on the config.
  if (LOCALES.length < 2) return null

  const setLocale = (locale: Locale) => {
    if (locale === current) return
    startTransition(() => {
      router.replace(pathname, { locale })
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={pending}
        >
          <IconLanguage />
          <span className="sr-only">{t("language")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => setLocale(locale)}
            className="cursor-pointer"
          >
            {i18n.locales[locale].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
