import { Geist, Geist_Mono } from "next/font/google"
import { notFound } from "next/navigation"
import type { Metadata } from "next"

import "@workspace/ui/globals.css"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { Toaster } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import { ThemeProvider } from "@/components/theme-provider"
import { NextIntlClientProvider } from "@/i18n/client"
import { routing } from "@/i18n/routing"
import { getMessagesForLocale } from "@/i18n/messages"
import { websiteConfig } from "@/lib/config/website"
import { TRPCReactProvider } from "@/lib/trpc/client"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export const metadata: Metadata = {
  title: {
    default: websiteConfig.metadata.title,
    template: `%s - OpenMCP`,
  },
  description: websiteConfig.metadata.description,
  metadataBase: new URL(websiteConfig.metadata.base_url),
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound()
  }

  const typedLocale = locale as (typeof routing.locales)[number]
  const messages = await getMessagesForLocale(typedLocale)

  return (
    <html
      lang={typedLocale}
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <NextIntlClientProvider locale={typedLocale} messages={messages}>
          <ThemeProvider>
            <TRPCReactProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </TRPCReactProvider>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
