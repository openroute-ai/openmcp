import { Geist, Geist_Mono } from "next/font/google"
import { notFound } from "next/navigation"
import type { Metadata, Viewport } from "next"

import "@/app/globals.css"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { Analytics } from "@/analytics/analytics"
import { AffonsoScript } from "@/components/affiliate/affonso"
import { TailwindIndicator } from "@/components/layout/tailwind-indicator"
import { ThemeProvider } from "@/components/theme-provider"
import { NextIntlClientProvider } from "@/i18n/client"
import { getMessagesForLocale } from "@/i18n/messages"
import { routing } from "@/i18n/routing"
import { websiteConfig } from "@/lib/config/website"
import { TRPCReactProvider } from "@/lib/trpc/client"
import { getBaseUrl } from "@/lib/urls/urls"

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
  // Relative OG/Twitter image paths in page metadata are resolved against this.
  metadataBase: new URL(getBaseUrl()),
}

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
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
  const baseUrl = getBaseUrl()

  // JSON-LD for the site as a whole. Page-level entities (article, product,
  // breadcrumb) belong to the page that renders them.
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "OpenMCP",
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description:
      typedLocale === "zh"
        ? websiteConfig.metadata.description
        : "OpenMCP is an MCP / A2A / Skills marketplace for AI Agents: Providers publish; users acquire assets free or paid and install them into Agents.",
  }

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "OpenMCP",
    url: baseUrl,
    description:
      typedLocale === "zh"
        ? websiteConfig.metadata.description
        : "OpenMCP — MCP / A2A / Skills marketplace for discovering, acquiring, and publishing Agent capabilities",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${baseUrl}${typedLocale === "zh" ? "" : `/${typedLocale}`}/skills?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
    inLanguage: typedLocale === "zh" ? "zh-CN" : "en-US",
  }

  const softwareApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OpenMCP",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    description:
      typedLocale === "zh"
        ? "OpenMCP 是面向 AI Agent 的 MCP / A2A / Skills 资产市场：创作者发布，用户免费或付费获取并装进 Agent。"
        : "OpenMCP is an MCP / A2A / Skills marketplace: Providers publish; users acquire and install assets into Agents.",
    featureList: [
      typedLocale === "zh" ? "MCP / A2A / Skills 资产目录" : "MCP / A2A / Skills catalog",
      typedLocale === "zh" ? "免费或付费获取资产" : "Acquire assets free or paid",
      typedLocale === "zh" ? "浏览、搜索与筛选" : "Browse, search, and filter",
      typedLocale === "zh" ? "装进 Agent 使用" : "Install into Agents",
      typedLocale === "zh" ? "免费使用" : "Free to use",
    ],
    url: baseUrl,
  }

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "AI Agent Asset Marketplace",
    provider: {
      "@type": "Organization",
      name: "OpenMCP",
    },
    areaServed: "Worldwide",
    description:
      typedLocale === "zh"
        ? "OpenMCP MCP / A2A / Skills 资产市场：发现、获取并装进 Agent；创作者可发布上架。"
        : "OpenMCP MCP / A2A / Skills marketplace: discover, acquire, and install into Agents; Providers can publish.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  }

  return (
    <html
      lang={typedLocale}
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <head>
        <AffonsoScript />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
        />
      </head>
      <body>
        <NextIntlClientProvider locale={typedLocale} messages={messages}>
          <ThemeProvider>
            <TRPCReactProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </TRPCReactProvider>
            <Toaster />
          </ThemeProvider>
          <TailwindIndicator />
          <Analytics />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
