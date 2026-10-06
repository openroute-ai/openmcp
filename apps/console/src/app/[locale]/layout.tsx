import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { notFound } from "next/navigation"

import "./globals.css"
// The values behind --radar-up / --radar-down / --radar-flat. globals.css
// registers the names; this is the only place that gives them light and dark
// values, so dropping the import silently turns every 涨/跌 colour into an
// unresolved `var()` and the anomaly feed loses its semantics.
import "./theme.css"
import {
  ThemeProvider,
  ThemeScript,
  ThemedToaster,
} from "@/components/theme-provider"
import { JsonLd } from "@/components/seo/json-ld"
import { routing } from "@/i18n/routing"
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  siteUrl,
} from "@/lib/config/site"
import { organizationNode, webSiteNode } from "@/lib/seo/structured-data"
import { siteNameForLocale } from "@/lib/seo/locale-name"
import { TRPCReactProvider } from "@/lib/trpc/client"
import { Analytics } from "@workspace/shared-next/analytics/analytics"
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
        {/* The site's own table of contents for answer engines, declared as a
            link relation so a client that reads `<link>` finds it. It cannot
            live in `alternates` in the metadata below: Next replaces the whole
            `alternates` object rather than merging it, so the one canonical
            link every page exports would take this declaration with it. */}
        <link
          rel="alternate"
          type="text/plain"
          href={siteUrl("/llms.txt")}
          title="llms.txt"
        />
      </head>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <TRPCReactProvider>
              <TooltipProvider>
                {/* Two facts about this site, stated once for every page: who
                    publishes it and what it is. They live here rather than on
                    the pages that are "about" the site because the pages a
                    crawler reaches first are rarely those — a shared link to a
                    project detail is a more common first visit than the
                    landing page, and a site identity that only the landing page
                    declares is invisible on every other URL. */}
                <JsonLd
                  node={[
                    organizationNode(),
                    webSiteNode(siteNameForLocale(locale), SITE_DESCRIPTION),
                  ]}
                />
                {children}
              </TooltipProvider>
              <ThemedToaster />
              {/* Page views. Renders nothing unless NODE_ENV is production and
                  NEXT_PUBLIC_UMAMI_WEBSITE_ID / NEXT_PUBLIC_UMAMI_SCRIPT are
                  both set, so a dev server or an unconfigured deployment never
                  emits a request. */}
              <Analytics />
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
 *
 * The defaults here are what a page gets when it exports no metadata of its own,
 * which after this file is the pages that do not need to say anything specific.
 *
 * Two of them are deliberately absent. There is no `alternates.canonical` here:
 * every page declares its own, and Next replaces the whole `alternates` object
 * rather than merging it, so a canonical inherited from the layout would be
 * dropped by each page that has one and inherited as `/` by the pages that do
 * not. And `title` is a plain string rather than a template with a default: the
 * pages that name themselves use `siteTitle`, which already spells the site out,
 * and a `%s` template on top of that would print the name twice.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: SITE_DESCRIPTION,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_CN",
    alternateLocale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [siteUrl("/og.png")],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/logo-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
}
