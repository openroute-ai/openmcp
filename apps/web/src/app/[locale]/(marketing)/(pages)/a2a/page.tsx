import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { assertLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { A2aMarketPageClient } from './a2a-page-client'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: SearchParams
}): Promise<Metadata> {
  const locale = assertLocale((await params).locale)
  const search = await searchParams
  const searchQuery = typeof search.search === 'string' ? search.search : undefined
  const t = await getTranslations({ locale, namespace: 'A2APage.meta' })

  const title = searchQuery
    ? locale === 'zh'
      ? `搜索"${searchQuery}" - ${t('title')}`
      : `Search "${searchQuery}" - ${t('title')}`
    : t('title')

  return constructMetadata({
    title,
    description: t('description'),
    canonicalUrl: getUrlWithLocale('/a2a', locale),
    keywords: ['A2A', 'Agent', 'AI Agent', 'Agent Card', 'agent-to-agent'],
    locale,
  })
}

export default async function A2aMarketPage({ searchParams }: { searchParams: SearchParams }) {
  // Read the query on the server and hand it down. Calling `useSearchParams`
  // in the client tree would opt this route out of static prerendering and
  // leave the server HTML empty, which the listing needs for crawlers.
  const search = await searchParams
  const first = (key: string) => {
    const value = search[key]
    return (Array.isArray(value) ? value[0] : value) ?? ''
  }

  return (
    <A2aMarketPageClient
      initialSearch={first('search')}
      initialAuthType={first('authType')}
      initialSort={first('sort')}
      initialPage={first('page')}
    />
  )
}
