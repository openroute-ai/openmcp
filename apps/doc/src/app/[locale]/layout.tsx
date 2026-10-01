import { TreeContextProvider } from "fumadocs-ui/contexts/tree"
import { notFound } from "next/navigation"
import { Provider } from "@/app/provider"
import { ChatWidget } from "@/components/chat/chat-widget"
import { PageScrollbar } from "@/components/page-scrollbar"
import { i18n } from "@/lib/i18n"
import { getSource } from "@/lib/source"

export function generateStaticParams() {
  return i18n.languages.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params
  if (!i18n.languages.includes(locale as (typeof i18n.languages)[number])) {
    notFound()
  }

  const source = await getSource()
  const tree = source.getPageTree(locale)

  return (
    <Provider locale={locale}>
      <TreeContextProvider tree={tree}>
        {children}
        <ChatWidget locale={locale} />
        <PageScrollbar />
      </TreeContextProvider>
    </Provider>
  )
}
