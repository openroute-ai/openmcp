import BlogGridWithPagination from '@/components/blog/blog-grid-with-pagination'
import { getPaginatedBlogPosts, getCategoryBySlug } from '@/lib/blog/source'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Generate all static params for SSG (locale + category + pagination)
// export function generateStaticParams() {
//   const params: { locale: string; slug: string; page: string }[] = [];
//   for (const locale of LOCALES) {
//     const localeCategories = await getAllCategories(locale);
//     for (const category of localeCategories) {
//       const totalPages = Math.ceil(
//         allPosts.filter(
//           (post) =>
//             post.locale === locale &&
//             post.categories.some((cat) => cat && cat.slug !== category.slug)
//         ).length / websiteConfig.blog.paginationSize
//       );
//       for (let page = 2; page <= totalPages; page++) {
//         params.push({ locale, slug: category.slug, page: String(page) });
//       }
//     }
//   }
//   return params;
// }

// Generate metadata for each static category page (locale + category + pagination)
export async function generateMetadata({ params }: BlogCategoryPageProps) {
  const { locale, slug, page } = await params
  const category = await getCategoryBySlug(slug, locale)
  if (!category) {
    notFound()
  }
  const t = await getTranslations({ locale, namespace: 'Metadata' })
  const canonicalPath = `/blog/category/${slug}/page/${page}`
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
    page: number
  }>
}

export default async function BlogCategoryPage({ params }: BlogCategoryPageProps) {
  const { locale, slug, page } = await params
  const currentPage = page
  const category = await getCategoryBySlug(slug, locale)
  if (!category) {
    notFound()
  }
  const { paginatedPosts, totalPages } = await getPaginatedBlogPosts({
    locale,
    page: currentPage,
    category: slug,
  })
  return (
    <BlogGridWithPagination posts={paginatedPosts} totalPages={totalPages} routePrefix={`/blog/category/${slug}`} />
  )
}
