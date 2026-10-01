import * as path from 'node:path'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@workspace/ui/components/hover-card'
import Link from 'fumadocs-core/link'
import { Banner } from 'fumadocs-ui/components/banner'
import { Callout } from 'fumadocs-ui/components/callout'
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import { CalendarIcon, ClockIcon, FileTextIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import type { ComponentProps, ComponentType, FC } from 'react'
import AllPostsButton from '@/components/blog/all-posts-button'
import BlogGrid from '@/components/blog/blog-grid'
import { BlogInlineTOC } from '@/components/blog/blog-inline-toc'
import { NewsletterCard } from '@/components/newsletter/newsletter-card'
import { LocaleLink } from '@/i18n/navigation'
import { getBlogPostsDetail, getPageByHref, getRelatedPosts, preloadPagesCache } from '@/lib/blog/source'
import type { ExtendedPost } from '@/lib/blog/types'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { formatDate } from '@/lib/utils'
import { getMDXComponents } from '@/mdx-components'

export const dynamic = 'force-dynamic'

/**
 * Gets the blog post from the params
 * @param slug - The slug of the blog post
 * @param locale - The locale of the blog post
 * @returns The blog post
 *
 * How it works:
 * /[locale]/blog/first-post:
 * params.slug = ["first-post"]
 * slug becomes "first-post" after join('/')
 * Matches post where slugAsParams === "first-post" AND locale === params.locale
 */
async function getBlogPostFromParams(locale: Locale, slug: string[]) {
  // console.log('getBlogPostFromParams', locale, slug);
  // Find post with matching slug and locale
  const post = await getBlogPostsDetail(slug, locale)

  if (!post) {
    // If no post found with the current locale, try to find one with the default locale
    const defaultPost = await getBlogPostsDetail(['index'], locale)

    return defaultPost
  }

  return post
}

// remove generateStaticParams for now, because blog post page is not static
// export function generateStaticParams() {
//   return LOCALES.map((locale) => {
//     const posts = allPosts.filter((post) => post.locale === locale);
//     return posts.map((post) => ({
//       locale,
//       slug: post.slugAsParams,
//     }));
//   });
// }

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata | undefined> {
  const { locale, slug } = await params
  const post = await getBlogPostFromParams(locale, slug)
  if (!post) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'Metadata' })

  return constructMetadata({
    title: `${post.title} | ${t('title')}`,
    description: post.description,
    canonicalUrl: getUrlWithLocale(post.slug, locale),
    image: post.image,
  })
}

interface BlogPostPageProps {
  params: Promise<{
    locale: Locale
    slug: string[]
  }>
}

export default async function BlogPostPage(props: BlogPostPageProps) {
  const { locale, slug } = await props.params
  const post = await getBlogPostFromParams(locale, slug)
  if (!post) {
    notFound()
  }
  const { toc, date: publishDate } = post
  const Mdx = post.body as unknown as ComponentType<{ components?: unknown }>
  const date = formatDate(publishDate ? new Date(publishDate) : new Date())
  // const toc = post.toc; //await getTableOfContents(post.body.toString() || "");

  // getTranslations may cause error DYNAMIC_SERVER_USAGE, so we set dynamic to force-static
  const t = await getTranslations('BlogPage')

  // 预加载页面缓存，用于 getPageByHref 同步查找
  await preloadPagesCache(locale)

  // get related posts
  const relatedPosts = await getRelatedPosts(locale, slug, post.categories?.map((category) => category?.slug)[0])

  return (
    <div className='flex flex-col gap-10'>
      {/* content section */}
      <div className='grid grid-cols-1 gap-10 lg:grid-cols-3 lg:gap-12'>
        {/* left column (blog post content) */}
        <div className='flex flex-col lg:col-span-2'>
          {/* Basic information */}
          <div className='space-y-6'>
            {/* blog post image */}
            <div className='group relative aspect-16/9 overflow-hidden rounded-lg border transition-all'>
              {post.image && (
                <Image
                  src={post.image}
                  alt={post.title || 'image for blog post'}
                  title={post.title || 'image for blog post'}
                  loading='eager'
                  fill
                  className='object-cover'
                />
              )}
            </div>

            {/* blog post date and reading time */}
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2'>
                <CalendarIcon className='size-4 text-muted-foreground' />
                <span className='my-auto text-muted-foreground text-small leading-none'>{date}</span>
              </div>
              <div className='flex items-center gap-2'>
                <ClockIcon className='size-4 text-muted-foreground' />
                <span className='my-auto text-muted-foreground text-small leading-none'>
                  {t('readTime', { minutes: post?.estimatedTime || 0 })}
                </span>
              </div>
            </div>

            {/* blog post title */}
            <h1 className='text-balance font-bold text-title'>{post.title}</h1>

            {/* blog post description */}
            <p className='text-pretty text-lead text-muted-foreground'>{post.description}</p>
          </div>

          {/* blog post content */}
          {/* `prose` 由 Fumadocs 的 typography 插件提供，见 `src/app/globals.css` */}
          <div className='prose mt-10 max-w-article prose-headings:scroll-mt-24 prose-headings:font-medium prose-headings:tracking-tight prose-img:rounded-lg'>
            <Mdx
              components={getMDXComponents({
                a: ({ href, ...props }) => {
                  const found = getPageByHref(href ?? '', {
                    language: locale,
                    dir: path.dirname((post as unknown as { path?: string }).path ?? ''),
                  })

                  if (!found) return <Link href={href} {...props} />

                  return (
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <Link href={found.hash ? `${found.page.url}#${found.hash}` : found.page.url} {...props} />
                      </HoverCardTrigger>
                      <HoverCardContent className='text-sm'>
                        <p className='font-medium'>{(found.page.data as { title?: string }).title}</p>
                        <p className='text-fd-muted-foreground'>
                          {(found.page.data as { description?: string }).description}
                        </p>
                      </HoverCardContent>
                    </HoverCard>
                  )
                },
                Banner,
                // 源项目注册了 Mermaid 组件；目标项目未安装 mermaid 依赖，删除该支持。
                CodeBlock,
                Pre,
                TypeTable,
                blockquote: Callout as unknown as FC<ComponentProps<'blockquote'>>,
              })}
            />
          </div>

          <div className='my-14 flex items-center justify-start'>
            <AllPostsButton />
          </div>
        </div>

        {/* right column (sidebar) */}
        <div>
          <div className='space-y-5 lg:sticky lg:top-24'>
            {/* author info */}
            <div className='rounded-lg bg-muted/50 p-6'>
              <h2 className='mb-4 font-semibold text-subsection'>{t('author')}</h2>
              <div className='flex items-center gap-4'>
                <div className='relative h-8 w-8 shrink-0'>
                  {post.author?.avatar && (
                    <Image
                      src={post.author.avatar}
                      alt={`avatar for ${post.author.name}`}
                      className='rounded-full border object-cover'
                      fill
                    />
                  )}
                </div>
                <span className='line-clamp-1'>{post.author?.name}</span>
              </div>
            </div>

            {/* categories */}
            <div className='rounded-lg bg-muted/50 p-6'>
              <h2 className='mb-4 font-semibold text-subsection'>{t('categories')}</h2>
              <ul className='flex flex-wrap gap-4'>
                {post.categories?.map(
                  (category) =>
                    category && (
                      <li key={category.slug}>
                        <LocaleLink
                          href={`/blog/category/${category.slug}`}
                          className='font-medium text-muted-foreground text-small hover:text-primary'
                        >
                          {category.name}
                        </LocaleLink>
                      </li>
                    )
                )}
              </ul>
            </div>
            <BlogInlineTOC items={toc} defaultOpen={true} className='hidden bg-muted/50 lg:block'>
              <h2 className='mb-4 font-semibold text-subsection'>{t('tableOfContents')}</h2>
            </BlogInlineTOC>
          </div>
        </div>
      </div>

      {/* Footer section shows related posts */}
      {relatedPosts && relatedPosts.length > 0 && (
        <div className='mt-4 flex flex-col gap-6'>
          <div className='flex items-center gap-2'>
            <FileTextIcon className='size-4 text-muted-foreground' />
            <h2 className='font-semibold text-gradient_indigo-purple text-section tracking-wider'>{t('morePosts')}</h2>
          </div>

          <BlogGrid posts={relatedPosts as unknown as ExtendedPost[]} />
        </div>
      )}

      {/* newsletter */}
      <div className='my-6 flex items-center justify-start'>
        <NewsletterCard />
      </div>
    </div>
  )
}
