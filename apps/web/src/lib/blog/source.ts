import * as path from 'node:path'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { TableOfContents } from 'fumadocs-core/toc'
import type { ComponentType } from 'react'
import { db } from '@/lib/db'
import { blogAuthors, blogCategories, blogPosts } from '@workspace/db'
import { websiteConfig } from '@/lib/config/website'
import { getPostCacheKey, useBlogStore } from './blog-store'
import { getDbCategoryWithPosts, getPaginatedDbBlogPosts } from './db-source'
import { blogMdxCompiler } from './mdx-remote-compiler'
import type { Author, Category, CategoryWithPosts, ExtendedPost } from './types'

/**
 * 计算预计阅读时间（分钟）
 */
function getEstimatedTime(body: string): number {
  const words = body.split(/\s+/).length
  return Math.ceil(words / 200)
}

/**
 * 从数据库获取单个博客文章详情
 * 只缓存编译后的 MDX 内容（因为编译耗时）
 */
export async function getBlogPostsDetail(slug: string[], locale: string) {
  const cacheKey = getPostCacheKey(slug, locale)
  const store = useBlogStore.getState()

  // 检查缓存（只缓存编译后的内容）
  const cached = store.getPost(cacheKey)
  if (cached) {
    return cached
  }

  // 从数据库查询文章
  const conditions = [
    eq(blogPosts.published, true),
    eq(blogPosts.locale, locale),
    sql`${blogPosts.slugs} = ${JSON.stringify(slug)}::jsonb`,
  ]

  const postResult = await db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      description: blogPosts.description,
      image: blogPosts.image,
      date: blogPosts.date,
      published: blogPosts.published,
      estimatedTime: blogPosts.estimatedTime,
      locale: blogPosts.locale,
      path: blogPosts.path,
      slugs: blogPosts.slugs,
      categoryIds: blogPosts.categoryIds,
      authorId: blogPosts.authorId,
      content: blogPosts.content,
      slug: blogPosts.slug,
    })
    .from(blogPosts)
    .where(and(...conditions))
    .limit(1)

  const post = postResult[0]
  if (!post) {
    return null
  }

  // 并行查询作者和分类
  const categoryIds = (post.categoryIds as string[]) ?? []
  const hasCategoryIds = Array.isArray(categoryIds) && categoryIds.length > 0

  let authorResult: Array<{
    id: string
    slug: string
    name: string
    avatar: string
    locale: string
  }> = []
  let categoryResult: Array<{
    id: string
    slug: string
    name: string
    description: string
    locale: string
  }> = []

  try {
    const results = await Promise.all([
      post.authorId
        ? db.select().from(blogAuthors).where(eq(blogAuthors.id, post.authorId)).limit(1)
        : Promise.resolve([]),
      hasCategoryIds
        ? db.select().from(blogCategories).where(inArray(blogCategories.id, categoryIds))
        : Promise.resolve([]),
    ])
    authorResult = results[0] ?? []
    categoryResult = results[1] ?? []
  } catch (error) {
    // 如果查询失败，使用空数组，不影响文章显示
    authorResult = []
    categoryResult = []
  }

  const author = authorResult[0]
  const categories = categoryResult.map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    locale: c.locale,
  }))
  // 编译 MDX 内容
  let body: ComponentType<{ components?: unknown }>
  let toc: TableOfContents

  try {
    const result = await blogMdxCompiler.compile({
      filePath: post.path,
      source: post.content,
    })
    body = result.body as ComponentType<{ components?: unknown }>
    toc = result.toc
  } catch (error) {
    // 编译失败时使用空内容
    body = '' as unknown as ComponentType<{ components?: unknown }>
    toc = {} as TableOfContents
  }

  // 构建结果
  const extendedPost = {
    title: post.title,
    description: post.description,
    image: post.image,
    date: post.date,
    published: post.published ?? true,
    estimatedTime: post.estimatedTime ?? getEstimatedTime(post.content),
    locale: post.locale,
    url: `/blog/${post.slugs.join('/')}`,
    path: post.path,
    slug: post.slug,
    slugAsParams: post.slugs.join('/'),
    body,
    toc,
    author: author
      ? {
          slug: author.slug,
          name: author.name,
          avatar: author.avatar,
          locale: author.locale,
        }
      : undefined,
    categories,
  } as unknown as ExtendedPost & { body: ComponentType<{ components?: unknown }> }

  // 缓存编译后的结果
  // store.setPost(cacheKey, extendedPost)

  return extendedPost
}

/**
 * 获取所有分类
 * 直接从数据库查询，不缓存
 */
export async function getAllCategories(locale?: string): Promise<Category[]> {
  try {
    const conditions = locale ? [eq(blogCategories.locale, locale)] : []
    const categories = await db
      .select()
      .from(blogCategories)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    return categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      locale: c.locale,
    }))
  } catch (error) {
    return []
  }
}

/**
 * 根据 slug 获取单个分类
 * 如果 includePosts 为 true，则包含该分类下的所有文章
 * 直接从数据库查询
 */
export async function getCategoryBySlug(
  slug: string,
  locale?: string,
  includePosts: boolean = false
): Promise<CategoryWithPosts | null> {
  try {
    // 从数据库查询分类
    const conditions = [eq(blogCategories.slug, slug), locale ? eq(blogCategories.locale, locale) : undefined].filter(
      Boolean
    )

    const categoryResult = await db
      .select()
      .from(blogCategories)
      .where(and(...conditions))
      .limit(1)

    if (!categoryResult[0]) {
      return null
    }

    const category = categoryResult[0]
    const categoryData: Category = {
      slug: category.slug,
      name: category.name,
      description: category.description,
      locale: category.locale,
    }

    // 如果不需要包含文章，直接返回
    if (!includePosts) {
      return categoryData
    }

    // 查询该分类下的所有已发布文章
    const posts = await db
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        path: blogPosts.path,
        slugs: blogPosts.slugs,
        title: blogPosts.title,
        description: blogPosts.description,
        image: blogPosts.image,
        date: blogPosts.date,
        published: blogPosts.published,
        estimatedTime: blogPosts.estimatedTime,
        locale: blogPosts.locale,
        authorId: blogPosts.authorId,
        categoryIds: blogPosts.categoryIds,
      })
      .from(blogPosts)
      .where(
        and(
          eq(blogPosts.published, true),
          locale ? eq(blogPosts.locale, locale) : undefined,
          sql`${blogPosts.categoryIds} @> ${JSON.stringify([category.id])}`
        )
      )
      .orderBy(desc(blogPosts.date))

    // 获取所有需要的作者和分类ID
    const authorIds = [...new Set(posts.map((p) => p.authorId).filter(Boolean) as string[])]
    const categoryIds = [...new Set(posts.flatMap((p) => ((p.categoryIds as string[]) ?? []).filter(Boolean)))]

    // 批量查询作者和分类
    const [authors, categories] = await Promise.all([
      authorIds.length > 0 ? db.select().from(blogAuthors).where(inArray(blogAuthors.id, authorIds)) : [],
      categoryIds.length > 0 ? db.select().from(blogCategories).where(inArray(blogCategories.id, categoryIds)) : [],
    ])

    // 创建映射表
    const authorMap = new Map(authors.map((a) => [a.id, a.slug]))
    const categoryMap = new Map(categories.map((c) => [c.id, c.slug]))

    // 转换文章数据
    const postsData = posts.map((post) => {
      const authorSlug = post.authorId ? authorMap.get(post.authorId) : undefined
      const categorySlugs = ((post.categoryIds as string[]) ?? [])
        .map((id) => categoryMap.get(id))
        .filter(Boolean) as string[]

      return {
        id: post.id,
        slug: post.slug,
        path: post.path,
        slugs: post.slugs,
        title: post.title,
        description: post.description,
        image: post.image,
        date: post.date,
        published: post.published ?? true,
        estimatedTime: post.estimatedTime ?? undefined,
        locale: post.locale,
        author: authorSlug ?? undefined,
        categories: categorySlugs,
      }
    })

    return {
      ...categoryData,
      posts: postsData,
    }
  } catch (error) {
    // 如果查询失败，尝试使用 db-source 的备用方法
    try {
      const dbResult = await getDbCategoryWithPosts(slug, locale, includePosts)
      if (!dbResult.category) {
        return null
      }

      const categoryData: Category = {
        slug: dbResult.category.slug,
        name: dbResult.category.name,
        description: dbResult.category.description,
        locale: dbResult.category.locale,
      }

      if (!includePosts) {
        return categoryData
      }

      // 获取所有需要的作者和分类ID
      const authorIds = [...new Set((dbResult.posts ?? []).map((p) => p.authorId).filter(Boolean) as string[])]
      const categoryIds = [
        ...new Set((dbResult.posts ?? []).flatMap((p) => ((p.categoryIds as string[]) ?? []).filter(Boolean))),
      ]

      // 批量查询作者和分类
      const [authors, categories] = await Promise.all([
        authorIds.length > 0 ? db.select().from(blogAuthors).where(inArray(blogAuthors.id, authorIds)) : [],
        categoryIds.length > 0 ? db.select().from(blogCategories).where(inArray(blogCategories.id, categoryIds)) : [],
      ])

      // 创建映射表
      const authorMap = new Map(authors.map((a) => [a.id, a.slug]))
      const categoryMap = new Map(categories.map((c) => [c.id, c.slug]))

      // 转换 posts
      const postsData = (dbResult.posts ?? []).map((post) => {
        const authorSlug = post.authorId ? authorMap.get(post.authorId) : undefined
        const categorySlugs = ((post.categoryIds as string[]) ?? [])
          .map((id) => categoryMap.get(id))
          .filter(Boolean) as string[]

        return {
          id: post.id,
          slug: post.slug,
          path: post.path,
          slugs: post.slugs,
          title: post.title,
          description: post.description,
          image: post.image,
          date: post.date,
          published: post.published ?? true,
          estimatedTime: post.estimatedTime ?? undefined,
          locale: post.locale,
          author: authorSlug ?? undefined,
          categories: categorySlugs,
        }
      })

      return {
        ...categoryData,
        posts: postsData,
      }
    } catch {
      return null
    }
  }
}

/**
 * 获取所有作者
 * 直接从数据库查询，不缓存
 */
export async function getAllAuthors(locale?: string): Promise<Author[]> {
  try {
    const conditions = locale ? [eq(blogAuthors.locale, locale)] : []
    const authors = await db
      .select()
      .from(blogAuthors)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    return authors.map((a) => ({
      slug: a.slug,
      name: a.name,
      avatar: a.avatar,
      locale: a.locale,
    }))
  } catch (error) {
    return []
  }
}

interface PaginatedBlogResult {
  paginatedPosts: ExtendedPost[]
  totalPages: number
  filteredPostsCount: number
}

/**
 * 获取分页博客文章
 * 直接从数据库查询
 */
export async function getPaginatedBlogPosts({
  locale,
  page = 1,
  category,
}: {
  locale?: string
  page?: number
  category?: string
}): Promise<PaginatedBlogResult> {
  const postsPerPage = websiteConfig.blog.paginationSize

  try {
    const dbResult = await getPaginatedDbBlogPosts({
      locale,
      page,
      limit: postsPerPage,
      categorySlug: category,
    })

    // 获取所有需要的作者和分类
    const neededAuthorSlugs = new Set<string>()
    const neededCategorySlugs = new Set<string>()

    for (const post of dbResult.posts) {
      if (post.data.author) {
        neededAuthorSlugs.add(post.data.author)
      }
      for (const catSlug of post.data.categories) {
        neededCategorySlugs.add(catSlug)
      }
    }

    // 并行获取作者和分类数据
    const [allAuthors, allCategories] = await Promise.all([getAllAuthors(locale), getAllCategories(locale)])

    // 创建查找映射
    const authorMap = new Map<string, Author>()
    for (const author of allAuthors) {
      if (neededAuthorSlugs.has(author.slug)) {
        authorMap.set(author.slug, author)
      }
    }

    const categoryMap = new Map<string, Category>()
    for (const cat of allCategories) {
      if (neededCategorySlugs.has(cat.slug)) {
        categoryMap.set(cat.slug, cat)
      }
    }

    // 转换文章数据
    const extendedPosts: ExtendedPost[] = dbResult.posts.map((post) => {
      const author = post.data.author ? authorMap.get(post.data.author) : undefined
      const categories = post.data.categories
        .map((catSlug: string) => categoryMap.get(catSlug))
        .filter(Boolean) as Category[]

      return {
        title: post.data.title,
        description: post.data.description,
        image: post.data.image,
        date: post.data.date,
        published: post.data.published,
        slug: post.data.slug,
        url: post.url,
        path: post.path,
        slugAsParams: post.slugs.join('/'),
        estimatedTime: post.data.estimatedTime,
        locale: post.data.locale,
        author,
        categories,
        body: '' as unknown as string,
        toc: {} as TableOfContents,
      } as ExtendedPost
    })

    return {
      paginatedPosts: extendedPosts,
      totalPages: dbResult.totalPages,
      filteredPostsCount: dbResult.total,
    }
  } catch (error) {
    return {
      paginatedPosts: [],
      totalPages: 0,
      filteredPostsCount: 0,
    }
  }
}

/**
 * 页面缓存，用于 getPageByHref 同步查找
 */
const pagesCache = new Map<string, Array<{ data: unknown; path: string; url: string; slugs: string[] }>>()

/**
 * 预加载页面到缓存（用于 getPageByHref 同步查找）
 * 直接从数据库加载所有文章的基本信息
 */
export async function preloadPagesCache(locale?: string) {
  const cacheKey = locale ?? 'all'
  if (pagesCache.has(cacheKey)) {
    return
  }

  try {
    const conditions = [eq(blogPosts.published, true)]
    if (locale) {
      conditions.push(eq(blogPosts.locale, locale))
    }

    const allPosts = await db
      .select({
        slug: blogPosts.slug,
        path: blogPosts.path,
        slugs: blogPosts.slugs,
        title: blogPosts.title,
        description: blogPosts.description,
      })
      .from(blogPosts)
      .where(and(...conditions))
      .orderBy(desc(blogPosts.date))

    const pages = allPosts.map((post) => ({
      url: `/blog/${(post.slugs as string[]).join('/')}`,
      path: post.path,
      slugs: post.slugs as string[],
      data: {
        title: post.title,
        description: post.description,
      },
    }))

    pagesCache.set(cacheKey, pages)
  } catch (error) {
    pagesCache.set(cacheKey, [])
  }
}

/**
 * 从 href 解析路径和 hash
 */
function parseHref(href: string, baseDir?: string): { path: string; hash?: string } {
  let cleanHref = href.replace(/^https?:\/\/[^/]+/, '')

  const hashIndex = cleanHref.indexOf('#')
  const hash = hashIndex >= 0 ? cleanHref.slice(hashIndex + 1) : undefined
  cleanHref = hashIndex >= 0 ? cleanHref.slice(0, hashIndex) : cleanHref

  const queryIndex = cleanHref.indexOf('?')
  cleanHref = queryIndex >= 0 ? cleanHref.slice(0, queryIndex) : cleanHref

  if (cleanHref.startsWith('/')) {
    cleanHref = cleanHref.replace(/^\/blog\/?/, '')
  } else if (baseDir) {
    const resolved = path.resolve(baseDir, cleanHref)
    cleanHref = resolved.replace(/^.*\/blog\/?/, '')
  }

  cleanHref = cleanHref.replace(/^\/+|\/+$/g, '')

  return { path: cleanHref, hash }
}

/**
 * 同步获取页面 by href
 * 注意：此函数需要在调用前预加载页面缓存
 */
export function getPageByHref(
  href: string,
  options?: {
    language?: string
    dir?: string
  }
):
  | {
      page: { data: unknown; path: string; url: string; slugs: string[] }
      hash?: string
    }
  | undefined {
  const locale = options?.language
  const cacheKey = locale ?? 'all'
  const pages = pagesCache.get(cacheKey)

  if (!pages || pages.length === 0) {
    return undefined
  }

  const { path: targetPath, hash } = parseHref(href, options?.dir)

  if (!targetPath) {
    return undefined
  }

  // 查找匹配的页面
  let found = pages.find((page) => {
    const pageUrl = page.url.replace(/^\/blog\/?/, '')
    return pageUrl === targetPath || pageUrl === `/${targetPath}`
  })

  if (!found) {
    const targetSlugs = targetPath.split('/').filter(Boolean)
    found = pages.find((page) => {
      return page.slugs.join('/') === targetSlugs.join('/')
    })
  }

  if (!found) {
    found = pages.find((page) => {
      const pagePath = page.path.replace(/\.(mdx?|md)$/, '').replace(/\.(zh|en|ja|ko)$/, '')
      return pagePath === targetPath || pagePath.endsWith(`/${targetPath}`)
    })
  }

  if (!found) {
    return undefined
  }

  return {
    page: found,
    hash,
  }
}

/**
 * 获取相关文章
 * 从数据库中随机选择相同分类的文章
 * 直接从数据库查询
 */
export async function getRelatedPosts(
  locale: string,
  slug: string[],
  category?: string,
  count: number = websiteConfig.blog.relatedPostsSize
) {
  try {
    const conditions = [
      eq(blogPosts.published, true),
      eq(blogPosts.locale, locale),
      sql`${blogPosts.slugs} != ${JSON.stringify(slug)}::jsonb`,
    ]

    if (category) {
      const categoryResult = await db
        .select({ id: blogCategories.id })
        .from(blogCategories)
        .where(and(eq(blogCategories.slug, category), eq(blogCategories.locale, locale)))
        .limit(1)

      if (categoryResult[0]) {
        conditions.push(sql`${blogPosts.categoryIds} @> ${JSON.stringify([categoryResult[0].id])}`)
      } else {
        return []
      }
    }

    const allPosts = await db
      .select()
      .from(blogPosts)
      .where(and(...conditions))
      .orderBy(desc(blogPosts.date))

    // 随机选择
    const shuffled = [...allPosts].sort(() => Math.random() - 0.5)
    const selectedPosts = shuffled.slice(0, count)

    // 获取所有需要的作者和分类ID
    const authorIds = [...new Set(selectedPosts.map((p) => p.authorId).filter(Boolean) as string[])]
    const categoryIds = [...new Set(selectedPosts.flatMap((p) => ((p.categoryIds as string[]) ?? []).filter(Boolean)))]

    // 批量查询作者和分类
    const [authors, categories] = await Promise.all([
      authorIds.length > 0 ? db.select().from(blogAuthors).where(inArray(blogAuthors.id, authorIds)) : [],
      categoryIds.length > 0 ? db.select().from(blogCategories).where(inArray(blogCategories.id, categoryIds)) : [],
    ])

    // 创建映射表
    const authorMap = new Map(authors.map((a) => [a.id, a.slug]))
    const categoryMap = new Map(categories.map((c) => [c.id, c.slug]))

    // 获取所有作者和分类的完整信息
    const allAuthors = await getAllAuthors(locale)
    const allCategories = await getAllCategories(locale)
    const authorInfoMap = new Map(allAuthors.map((a) => [a.slug, a]))
    const categoryInfoMap = new Map(allCategories.map((c) => [c.slug, c]))

    // 转换文章数据
    return selectedPosts.map((post) => {
      const authorSlug = post.authorId ? authorMap.get(post.authorId) : undefined
      const categorySlugs = ((post.categoryIds as string[]) ?? [])
        .map((id) => categoryMap.get(id))
        .filter(Boolean) as string[]

      return {
        title: post.title,
        description: post.description,
        image: post.image,
        date: post.date,
        published: post.published ?? true,
        slug: post.slug,
        slugAsParams: post.slugs.join('/'),
        estimatedTime: post.estimatedTime ?? undefined,
        locale: post.locale,
        author: authorSlug ? authorInfoMap.get(authorSlug) : undefined,
        categories: categorySlugs.map((slug) => categoryInfoMap.get(slug)).filter(Boolean) as Category[],
      }
    })
  } catch (error) {
    return []
  }
}
