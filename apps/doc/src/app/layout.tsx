import { NextProvider } from "fumadocs-core/framework/next"
import { Geist, Geist_Mono } from "next/font/google"
import type { Metadata, Viewport } from "next"

import { siteUrl } from "@/lib/shared"
import "./global.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "OpenMCP 文档",
    template: "%s - OpenMCP",
  },
  description:
    "OpenMCP 是面向 AI Agent 的 MCP / A2A / Skills 资产市场：发布、获取并装进 Agent。",
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh"
      className={`${geist.variable} ${fontMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <NextProvider>{children}</NextProvider>
      </body>
    </html>
  )
}
