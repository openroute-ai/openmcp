import type { Metadata } from 'next'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { SkillsPageClient } from './skills-page-client'

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
      ? `搜索"${searchQuery}" - Skills 仓库`
      : `Search "${searchQuery}" - Skills Repository`
    : locale === 'zh'
      ? '全部技能 - Skills 仓库'
      : 'All Skills - Skills Repository'

  const description =
    locale === 'zh'
      ? '快速发现专家技能，让 AI 从通用走向专用。可复用的自动化技能组件，像搭积木一样组合使用，快速构建你的 AI 工作流。'
      : 'Quickly discover expert skills to take AI from generic to specialized. Reusable automation skill components, combined like building blocks to quickly build your AI workflows.'

  return constructMetadata({
    title,
    description,
    canonicalUrl: getUrlWithLocale('/skills', locale),
    keywords: ['Skills', 'AI'],
    locale,
  })
}

export default function SkillsPage() {
  return <SkillsPageClient />
}
