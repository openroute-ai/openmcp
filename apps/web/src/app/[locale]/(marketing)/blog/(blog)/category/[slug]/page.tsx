import BlogGridWithPagination from '@/components/blog/blog-grid-with-pagination'
import { getPaginatedBlogPosts, getCategoryBySlug } from '@/lib/blog/source'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Generate all static params for SSG (locale + category)
// export async function generateStaticParams() {
//   const allCategories = await getAllCategories();
//   const params: { locale: string; slug: string }[] = [];
//   for (const locale of LOCALES) {
//     const localeCategories = allCategories.filter(
//       (category) => category.locale === locale
//     );
//     for (const category of localeCategories) {
//       params.push({ locale, slug: category.slug });
//     }
//   }
//   return params;
// }

// Generate metadata for each static category page (locale + category)
export async function generateMetadata({ params }: BlogCategoryPageProps) {
  const { locale, slug } = await params
  const category = await getCategoryBySlug(slug, locale as string)
  if (!category) {
    notFound()
  }
  const t = await getTranslations({ locale, namespace: 'Metadata' })
  const canonicalPath = `/blog/category/${slug}`
  return constructMetadata({
    title: `${category.name} | ${t('title')}`,
    description: category.description,
    canonicalUrl: getUrlWithLocale(canonicalPath, locale),
  })
}

interface BlogCategoryPageProps {
  params: Promise<{
    locale: Locale
    slug: string
  }>
}

export default async function BlogCategoryPage({ params }: BlogCategoryPageProps) {
  const { locale, slug } = await params
  const category = await getCategoryBySlug(slug, locale as string)
  if (!category) {
    notFound()
  }
  const currentPage = 1
  const { paginatedPosts, totalPages } = await getPaginatedBlogPosts({
    locale,
    page: currentPage,
    category: slug,
  })
  return (
    <BlogGridWithPagination posts={paginatedPosts} totalPages={totalPages} routePrefix={`/blog/category/${slug}`} />
  )
}
