import type { Metadata } from 'next'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { WorkflowsPageClient } from './workflows-page-client'

/**
 * Generate metadata for workflows list page
 */
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
  const categorySlugs = typeof search.categorySlugs === 'string' ? search.categorySlugs : undefined

  // Build title and description based on filters
  let title: string
  let description: string
  const keywords: string[] = ['工作流', 'workflow', '工作流模板', 'workflow template']

  if (searchQuery) {
    title =
      locale === 'zh'
        ? `搜索"${searchQuery}" - 工作流库`
        : `Search "${searchQuery}" - Workflow Library`
    description =
      locale === 'zh'
        ? `搜索关键词"${searchQuery}"的工作流模板，找到最适合的自动化解决方案`
        : `Search workflow templates for "${searchQuery}", find the best automation solutions`
    keywords.push(searchQuery)
  } else if (categorySlugs) {
    title =
      locale === 'zh'
        ? `${categorySlugs}分类 - 工作流库`
        : `${categorySlugs} Category - Workflow Library`
    description =
      locale === 'zh'
        ? `浏览${categorySlugs}分类下的工作流模板`
        : `Browse workflow templates in ${categorySlugs} category`
    keywords.push(categorySlugs)
  } else {
    title = locale === 'zh' ? '工作流库 - 数千个工作流模板' : 'Workflow Library - Thousands of Workflow Templates'
    description =
      locale === 'zh'
        ? '浏览数千个经过认证的工作流模板，支持搜索、分类和下载，帮助您快速找到自动化解决方案'
        : 'Browse thousands of certified workflow templates, support search, categorization and download, help you quickly find automation solutions'
  }

  return constructMetadata({
    title,
    description,
    canonicalUrl: getUrlWithLocale('/workflows', locale),
    keywords,
    locale,
  })
}

export default function WorkflowsPage() {
  return <WorkflowsPageClient />
}
