import { Geist, Geist_Mono } from "next/font/google"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { notFound } from "next/navigation"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { routing } from "@/i18n/routing"
import { TRPCReactProvider } from "@/lib/trpc/client"
import { Toaster } from "@workspace/ui/components/sonner"
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
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <TRPCReactProvider>
              <TooltipProvider>{children}</TooltipProvider>
              <Toaster />
            </TRPCReactProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
