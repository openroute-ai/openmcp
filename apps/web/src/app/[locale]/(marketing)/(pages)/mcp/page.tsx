import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { McpMarketPageClient } from './mcp-page-client'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: SearchParams
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const search = await searchParams
  const searchQuery = typeof search.search === 'string' ? search.search : undefined
  const t = await getTranslations({ locale, namespace: 'McpPage.meta' })

  const title = searchQuery
    ? locale === 'zh'
      ? `搜索"${searchQuery}" - ${t('title')}`
      : `Search "${searchQuery}" - ${t('title')}`
    : t('title')

  return constructMetadata({
    title,
    description: t('description'),
    canonicalUrl: getUrlWithLocale('/mcp', locale),
    keywords: ['MCP', 'MCP Server', 'Model Context Protocol', 'tools'],
    locale,
  })
}

export default async function McpMarketPage({ searchParams }: { searchParams: SearchParams }) {
  // Read the query on the server and hand it down. Calling `useSearchParams`
  // in the client tree would opt this route out of static prerendering and
  // leave the server HTML empty, which the listing needs for crawlers.
  const search = await searchParams
  const first = (key: string) => {
    const value = search[key]
    return (Array.isArray(value) ? value[0] : value) ?? ''
  }

  return (
    <McpMarketPageClient
      initialSearch={first('search')}
      initialTransport={first('transport')}
      initialScope={first('scope')}
      initialSort={first('sort')}
      initialPage={first('page')}
    />
  )
}
