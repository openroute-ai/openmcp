import type { Metadata } from 'next'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { ToolsPageClient } from './tools-page-client'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const search = await searchParams
  const searchQuery = typeof search.search === 'string' ? search.search : undefined

  const title = searchQuery
    ? locale === 'zh'
      ? `搜索"${searchQuery}" - MCP 工具库`
      : `Search "${searchQuery}" - MCP Tools`
    : locale === 'zh'
      ? 'MCP 工具库 - 浏览工具列表'
      : 'MCP Tools - Browse Tool Library'

  const description =
    locale === 'zh'
      ? '浏览各技能包提供的 MCP 工具，查看输入输出与用法'
      : 'Browse MCP tools provided by skills, view input/output and usage'

  return constructMetadata({
    title,
    description,
    canonicalUrl: getUrlWithLocale('/tools', locale),
    keywords: ['MCP', '工具', 'tools', 'API'],
    locale,
  })
}

export default function ToolsPage() {
  return <ToolsPageClient />
}
