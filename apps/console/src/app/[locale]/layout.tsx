import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { notFound } from "next/navigation"

import "@workspace/ui/globals.css"
import "./theme.css"
import {
  ThemeProvider,
  ThemeScript,
  ThemedToaster,
} from "@/components/theme-provider"
import { routing } from "@/i18n/routing"
import { SITE_ORIGIN } from "@/lib/config/site"
import { TRPCReactProvider } from "@/lib/trpc/client"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/**
 * The root layout, scoped to a locale.
 *
 * There is no `app/layout.tsx` above this one: every page lives under
 * `[locale]` and the API routes need no document, so this is the only layout
 * and the only place `<html lang>` is set.
 *
 * https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
 */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params

  // The proxy rewrites unknown prefixes away, so reaching an unsupported
  // locale means the URL was built wrong. Failing loudly beats rendering the
  // default locale's messages under a URL that promises something else.
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <head>
        {/* Sets the theme class before the first paint, from the document
            rather than from the React tree: see ThemeScript. */}
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <TRPCReactProvider>
              <TooltipProvider>{children}</TooltipProvider>
              <ThemedToaster />
            </TRPCReactProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

/**
 * Site-wide metadata, and the only place `metadataBase` is set.
 *
 * It belongs on the layout rather than on the homepage because every route needs
 * it, not just the one: `metadataBase` is what turns a relative image or
 * alternate URL into an absolute one, and a page that forgot it would emit
 * `/og.png` for a crawler to resolve against nothing. The icons are declared
 * explicitly rather than left to the `app/` file conventions because the sizes
 * differ — the vector mark is the one every modern browser should take, and the
 * raster sizes exist for the clients that cannot take it.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/logo-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
}
