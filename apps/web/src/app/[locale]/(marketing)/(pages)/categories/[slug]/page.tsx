import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { assertLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { categoriesDataAccess } from '@/web/categories'
import { CategoryPageClient } from './category-page-client'

export const dynamic = 'force-dynamic'

/**
 * Generate metadata for category page
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const localeTyped = assertLocale((await params).locale)

  const category = await categoriesDataAccess.getCategoryBySlug(decodeURIComponent(slug), localeTyped)

  if (!category) {
    return constructMetadata({
      title: localeTyped === 'zh' ? '分类未找到 - OpenMCP' : 'Category Not Found - OpenMCP',
      description:
        localeTyped === 'zh'
          ? '抱歉，我们找不到您要查找的分类。'
          : 'Sorry, we could not find the category you are looking for.',
      canonicalUrl: getUrlWithLocale(`/categories/${slug}`, localeTyped),
      locale: localeTyped,
    })
  }

  const categoryName = localeTyped === 'zh' ? category.name : category.nameEn || category.name
  const categoryDescription =
    localeTyped === 'zh'
      ? category.description || category.descriptionEn || ''
      : category.descriptionEn || category.description || ''

  const title =
    localeTyped === 'zh'
      ? `${categoryName} - OpenMCP 技能分类`
      : `${categoryName} - OpenMCP Skill Category`

  const description =
    categoryDescription ||
    (localeTyped === 'zh'
      ? `浏览${categoryName}分类下的${category.workflowCount || 0}个技能，找到最适合的自动化解决方案`
      : `Browse ${category.workflowCount || 0} skills in ${categoryName} category, find the best automation solutions`)

  const keywords = [
    categoryName,
    'OpenMCP ClawSourcing skill',
    'OpenClaw',
    'skills',
    'automation',
  ]

  return constructMetadata({
    title,
    description: description.substring(0, 160),
    canonicalUrl: getUrlWithLocale(`/categories/${category.slug}`, localeTyped),
    keywords,
    locale: localeTyped,
  })
}

export default function CategoryPage() {
  return <CategoryPageClient />
}
