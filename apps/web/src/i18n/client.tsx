"use client"

import { NextIntlClientProvider as IntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import type { Locale } from "@/i18n/routing"

/**
 * Client boundary for next-intl.
 *
 * The server layout passes an already-resolved locale and message catalogue, so
 * the client never has to guess which locale is active or refetch messages.
 *
 * https://next-intl.dev/docs/usage/configuration#next-intlclientprovider
 */
export function NextIntlClientProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale
  messages: Record<string, unknown>
  children: ReactNode
}) {
  return (
    <IntlClientProvider
      locale={locale}
      messages={messages}
      // Pinned so server and client format dates/times identically; without
      // this next-intl falls back to the host timezone and hydration mismatches.
      timeZone="UTC"
    >
      {children}
    </IntlClientProvider>
  )
}
