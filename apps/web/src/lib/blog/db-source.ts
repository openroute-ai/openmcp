import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DynamicSource, VirtualFile } from 'fumadocs-core/source'
import { db } from '@/lib/db'
import { blogAuthors, blogCategories, blogPosts } from '@workspace/db'

// 全局缓存，用于存储从数据库加载的文件
let dbBlogFilesCache: VirtualFile[] | null = null
let dbBlogFilesPromise: Promise<VirtualFile[]> | null = null

/**
 * 从数据库获取所有博客文章并转换为 VirtualFile[]
 */
async function loadDbBlogFiles(): Promise<VirtualFile[]> {
  // 从数据库获取所有博客文章
  const allPosts = await db.select().from(blogPosts).where(eq(blogPosts.published, true)).orderBy(blogPosts.date)

  // 获取所有需要的作者和分类ID
  const authorIds = [...new Set(allPosts.map((p) => p.authorId).filter(Boolean) as string[])]
  const categoryIds = [...new Set(allPosts.flatMap((p) => ((p.categoryIds as string[]) ?? []).filter(Boolean)))]

  // 批量查询作者和分类
  const [authors, categories] = await Promise.all([
    authorIds.length > 0 ? db.select().from(blogAuthors).where(inArray(blogAuthors.id, authorIds)) : [],
    categoryIds.length > 0 ? db.select().from(blogCategories).where(inArray(blogCategories.id, categoryIds)) : [],
  ])

  // 创建映射表
  const authorMap = new Map(authors.map((a) => [a.id, a.slug]))
  const categoryMap = new Map(categories.map((c) => [c.id, c.slug]))

  return allPosts.map((post) => ({
    path: post.path,
    absolutePath: post.path,
    type: 'page' as const,
    slugs: post.slugs,
    data: {
      title: post.title,
      description: post.description,
      image: post.image,
      date: post.date,
      published: post.published ?? true,
      slug: post.slug,
      // 将 authorId 转换为 author slug
      author: post.authorId ? (authorMap.get(post.authorId) ?? undefined) : undefined,
      // 将 categoryIds 转换为 category slug 数组
      categories: ((post.categoryIds as string[]) ?? []).map((id) => categoryMap.get(id)).filter(Boolean) as string[],
      estimatedTime: post.estimatedTime ?? undefined,
      locale: post.locale,
      // 直接返回原始 MDX 内容，由 mdx-remote 在 source.ts 中编译
      content: post.content,
    },
  }))
}

/**
 * 获取数据库博客文件（带缓存）
 */
export async function getDbBlogFiles(): Promise<VirtualFile[]> {
  if (dbBlogFilesCache) {
    return dbBlogFilesCache
  }

  if (dbBlogFilesPromise) {
    return dbBlogFilesPromise
  }

  dbBlogFilesPromise = loadDbBlogFiles().then((files) => {
    dbBlogFilesCache = files
    return files
  })

  return dbBlogFilesPromise
}

/**
 * 创建基于数据库的 Blog Source
 * 使用 mdx-remote 进行编译，直接返回 content 字段
 * 返回符合 Source 接口的对象，包含 files 属性
 */
export function createDbBlogSource(): DynamicSource {
  // 预加载数据（异步，不阻塞）
  getDbBlogFiles().catch(() => {
    // 忽略错误，缓存会保持为 null
  })

  return {
    files: (): VirtualFile[] => {
      // 返回缓存的文件，如果还没有加载完成则返回空数组
      // loader 会处理空数组的情况
      return dbBlogFilesCache ?? []
    },
    async getPages(locale?: string) {
      // 从数据库获取所有博客文章
      const allPosts = await db
        .select()
        .from(blogPosts)
        .where(and(eq(blogPosts.published, true), locale ? eq(blogPosts.locale, locale) : undefined))
        .orderBy(blogPosts.date)

      // 获取所有需要的作者和分类ID
      const authorIds = [...new Set(allPosts.map((p) => p.authorId).filter(Boolean) as string[])]
      const categoryIds = [...new Set(allPosts.flatMap((p) => ((p.categoryIds as string[]) ?? []).filter(Boolean)))]

      // 批量查询作者和分类
      const [authors, categories] = await Promise.all([
        authorIds.length > 0 ? db.select().from(blogAuthors).where(inArray(blogAuthors.id, authorIds)) : [],
        categoryIds.length > 0 ? db.select().from(blogCategories).where(inArray(blogCategories.id, categoryIds)) : [],
      ])

      // 创建映射表
      const authorMap = new Map(authors.map((a) => [a.id, a.slug]))
      const categoryMap = new Map(categories.map((c) => [c.id, c.slug]))

      return allPosts.map((post) => ({
        url: `/blog/${post.slugs.join('/')}`,
        path: post.path,
        slugs: post.slugs,
        data: {
          title: post.title,
          description: post.description,
          image: post.image,
          date: post.date,
          published: post.published ?? true,
          slug: post.slug,
          // 将 authorId 转换为 author slug
          author: post.authorId ? (authorMap.get(post.authorId) ?? undefined) : undefined,
          // 将 categoryIds 转换为 category slug 数组
          categories: ((post.categoryIds as string[]) ?? [])
            .map((id) => categoryMap.get(id))
            .filter(Boolean) as string[],
          estimatedTime: post.estimatedTime ?? undefined,
          locale: post.locale,
          // 直接返回原始 MDX 内容，由 mdx-remote 在 source.ts 中编译
          content: post.content,
          _file: {
            absolutePath: post.path,
          },
        },
      }))
    },

    async getPage(slugs: string[], locale?: string) {
      // 构建查询条件
      const conditions = [eq(blogPosts.published, true)]
      if (locale) {
        conditions.push(eq(blogPosts.locale, locale))
      }

      // 使用 JSONB 操作符精确匹配 slugs 数组
      // 确保 slugs 数组的长度和内容都完全匹配
      conditions.push(sql`${blogPosts.slugs} = ${JSON.stringify(slugs)}::jsonb`)

      const whereClause = and(...conditions)

      // 直接查询匹配的文章（更高效）
      const postResult = await db.select().from(blogPosts).where(whereClause).limit(1)

      const post = postResult[0]
      if (!post) return null

      // 查询作者和分类信息
      const [author, categories] = await Promise.all([
        post.authorId ? db.select().from(blogAuthors).where(eq(blogAuthors.id, post.authorId)).limit(1) : [],
        (post.categoryIds as string[])?.length > 0
          ? db
              .select()
              .from(blogCategories)
              .where(inArray(blogCategories.id, post.categoryIds as string[]))
          : [],
      ])

      return {
        url: `/blog/${post.slugs.join('/')}`,
        path: post.path,
        slugs: post.slugs,
        data: {
          title: post.title,
          description: post.description,
          image: post.image,
          date: post.date,
          published: post.published ?? true,
          slug: post.slug,
          // 将 authorId 转换为 author slug
          author: author[0]?.slug ?? undefined,
          // 将 categoryIds 转换为 category slug 数组
          categories: categories.map((c) => c.slug),
          estimatedTime: post.estimatedTime ?? undefined,
          locale: post.locale,
          // 直接返回原始 MDX 内容，由 mdx-remote 在 source.ts 中编译
          content: post.content,
          _file: {
            absolutePath: post.path,
          },
        },
      }
    },

    // Blog 不需要 pageTree
    get pageTree() {
      return { children: [] }
    },
  } as DynamicSource
}

/**
 * 创建基于数据库的 Authors Source
 */
export function createDbAuthorsSource(): DynamicSource {
  return {
    files: (): VirtualFile[] => [],
    async getPages(locale?: string) {
      const allAuthors = await db
        .select()
        .from(blogAuthors)
        .where(locale ? eq(blogAuthors.locale, locale) : undefined)

      return allAuthors.map((author) => ({
        url: `/author/${author.slug}`,
        path: `${author.slug}.mdx`,
        slugs: [author.slug],
        data: {
          slug: author.slug,
          name: author.name,
          avatar: author.avatar,
          locale: author.locale,
          content: '',
          _file: {
            absolutePath: `${author.slug}.mdx`,
          },
        },
      }))
    },

    async getPage(slugs: string[], locale?: string) {
      if (slugs.length === 0) return null

      const author = await db
        .select()
        .from(blogAuthors)
        .where(and(eq(blogAuthors.slug, slugs[0] ?? ''), locale ? eq(blogAuthors.locale, locale) : undefined))
        .limit(1)

      if (!author[0]) return null

      return {
        url: `/author/${author[0].slug}`,
        path: `${author[0].slug}.mdx`,
        slugs: [author[0].slug],
        data: {
          slug: author[0].slug,
          name: author[0].name,
          avatar: author[0].avatar,
          locale: author[0].locale,
          content: '',
          _file: {
            absolutePath: `${author[0].slug}.mdx`,
          },
        },
      }
    },

    get pageTree() {
      return { children: [] }
    },
  } as DynamicSource
}

// 全局缓存，用于存储从数据库加载的分类文件
let dbCategoriesFilesCache: VirtualFile[] | null = null
let dbCategoriesFilesPromise: Promise<VirtualFile[]> | null = null

/**
 * 从数据库获取所有分类并转换为 VirtualFile[]
 */
async function loadDbCategoriesFiles(): Promise<VirtualFile[]> {
  const allCategories = await db.select().from(blogCategories)

  return allCategories.map((category) => ({
    path: `${category.slug}.mdx`,
    absolutePath: `${category.slug}.mdx`,
    type: 'page' as const,
    slugs: [category.slug],
    data: {
      slug: category.slug,
      name: category.name,
      description: category.description,
      locale: category.locale,
      content: '',
    },
  }))
}

/**
 * 获取数据库分类文件（带缓存）
 */
async function getDbCategoriesFiles(): Promise<VirtualFile[]> {
  if (dbCategoriesFilesCache) {
    return dbCategoriesFilesCache
  }

  if (dbCategoriesFilesPromise) {
    return dbCategoriesFilesPromise
  }

  dbCategoriesFilesPromise = loadDbCategoriesFiles().then((files) => {
    dbCategoriesFilesCache = files
    return files
  })

  return dbCategoriesFilesPromise
}

/**
 * 创建基于数据库的 Categories Source
 */
export function createDbCategoriesSource(): DynamicSource {
  // 预加载数据（异步，不阻塞）
  getDbCategoriesFiles().catch(() => {
    // 忽略错误，缓存会保持为 null
  })

  return {
    files: (): VirtualFile[] => {
      // 返回缓存的文件，如果还没有加载完成则返回空数组
      // loader 会处理空数组的情况，但也会调用 getPages 作为后备
      const files = dbCategoriesFilesCache ?? []
      return files
    },
    async getPages(locale?: string) {
      const conditions = []
      if (locale) {
        conditions.push(eq(blogCategories.locale, locale))
      }
      const allCategories = await db
        .select()
        .from(blogCategories)
        .where(conditions.length > 0 ? and(...conditions) : undefined)

      return allCategories.map((category) => ({
        url: `/categories/${category.slug}`,
        path: `${category.slug}.mdx`,
        slugs: [category.slug],
        data: {
          slug: category.slug,
          name: category.name,
          description: category.description,
          locale: category.locale,
          content: '',
          _file: {
            absolutePath: `${category.slug}.mdx`,
          },
        },
      }))
    },

    async getPage(slugs: string[], locale?: string) {
      if (slugs.length === 0) return null

      const category = await db
        .select()
        .from(blogCategories)
        .where(and(eq(blogCategories.slug, slugs[0] ?? ''), locale ? eq(blogCategories.locale, locale) : undefined))
        .limit(1)

      if (!category[0]) return null

      return {
        url: `/categories/${category[0].slug}`,
        path: `${category[0].slug}.mdx`,
        slugs: [category[0].slug],
        data: {
          slug: category[0].slug,
          name: category[0].name,
          description: category[0].description,
          locale: category[0].locale,
          content: '',
          _file: {
            absolutePath: `${category[0].slug}.mdx`,
          },
        },
      }
    },

    get pageTree() {
      return { children: [] }
    },
  } as DynamicSource
}

/**
 * 清除博客文件缓存（用于开发环境或需要刷新数据时）
 */
export function clearDbBlogCache(): void {
  dbBlogFilesCache = null
  dbBlogFilesPromise = null
}

/**
 * 清除分类文件缓存（用于开发环境或需要刷新数据时）
 */
export function clearDbCategoriesCache(): void {
  dbCategoriesFilesCache = null
  dbCategoriesFilesPromise = null
}

/**
 * 从数据库获取分类及其 blog_posts
 * @param slug 分类 slug
 * @param locale 语言环境
 * @param includePosts 是否包含该分类下的 blog_posts
 * @returns 分类信息及其 blog_posts（如果 includePosts 为 true）
 */
export async function getDbCategoryWithPosts(
  slug: string,
  locale?: string,
  includePosts: boolean = false
): Promise<{
  category: {
    id: string
    slug: string
    name: string
    description: string
    locale: string
  } | null
  posts?: Array<{
    id: string
    slug: string
    path: string
    slugs: string[]
    title: string
    description: string
    image: string
    date: Date
    published: boolean | null
    estimatedTime?: number | null
    locale: string
    authorId?: string | null
    categoryIds: string[] | null
  }>
}> {
  // 查询分类
  const categoryResult = await db
    .select()
    .from(blogCategories)
    .where(and(eq(blogCategories.slug, slug), locale ? eq(blogCategories.locale, locale) : undefined))
    .limit(1)

  if (!categoryResult[0]) {
    return { category: null }
  }

  const category = categoryResult[0]

  // 如果不需要包含 posts，直接返回
  if (!includePosts) {
    return {
      category: {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        locale: category.locale,
      },
    }
  }

  // 查询该分类下的所有已发布的 blog_posts
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
        // 使用 JSONB @> 操作符检查 categoryIds 数组是否包含该分类ID
        sql`${blogPosts.categoryIds} @> ${JSON.stringify([category.id])}`
      )
    )
    .orderBy(desc(blogPosts.date))

  return {
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      locale: category.locale,
    },
    posts,
  }
}

/**
 * 从数据库分页查询博客文章
 * @param options 查询选项
 * @returns 分页结果
 */
export async function getPaginatedDbBlogPosts({
  locale,
  page = 1,
  limit,
  categorySlug,
}: {
  locale?: string
  page?: number
  limit: number
  categorySlug?: string
}): Promise<{
  posts: Array<{
    url: string
    path: string
    slugs: string[]
    data: {
      title: string
      description: string
      image: string
      date: Date
      published: boolean
      slug: string
      author?: string
      categories: string[]
      estimatedTime?: number
      locale: string
      content: string
    }
  }>
  total: number
  totalPages: number
}> {
  const offset = (page - 1) * limit

  // 构建查询条件
  const conditions = [eq(blogPosts.published, true)]
  if (locale) {
    conditions.push(eq(blogPosts.locale, locale))
  }

  // 如果指定了分类，需要先查询分类ID，然后在 SQL 中过滤
  if (categorySlug) {
    const category = await db
      .select({ id: blogCategories.id })
      .from(blogCategories)
      .where(eq(blogCategories.slug, categorySlug))
      .limit(1)

    if (category[0]) {
      // 使用 PostgreSQL 的 JSONB @> 操作符检查数组是否包含分类ID
      // @> 操作符检查左侧 JSONB 是否包含右侧 JSONB
      conditions.push(sql`${blogPosts.categoryIds} @> ${JSON.stringify([category[0].id])}`)
    } else {
      // 如果分类不存在，返回空结果
      return {
        posts: [],
        total: 0,
        totalPages: 0,
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // 并行查询数据和总数
  const [data, totalResult] = await Promise.all([
    db
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
        authorId: blogPosts.authorId,
        categoryIds: blogPosts.categoryIds,
        locale: blogPosts.locale,
        content: blogPosts.content,
      })
      .from(blogPosts)
      .where(whereClause)
      .orderBy(desc(blogPosts.date))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(blogPosts).where(whereClause),
  ])

  const total = totalResult[0]?.count ?? 0
  const filteredData = data

  // 获取所有需要的作者和分类ID
  const authorIds = [...new Set(filteredData.map((p) => p.authorId).filter(Boolean) as string[])]
  const allCategoryIds = [...new Set(filteredData.flatMap((p) => ((p.categoryIds as string[]) ?? []).filter(Boolean)))]

  // 批量查询作者和分类
  const [authors, categories] = await Promise.all([
    authorIds.length > 0 ? db.select().from(blogAuthors).where(inArray(blogAuthors.id, authorIds)) : [],
    allCategoryIds.length > 0 ? db.select().from(blogCategories).where(inArray(blogCategories.id, allCategoryIds)) : [],
  ])

  // 创建映射表
  const authorMap = new Map(authors.map((a) => [a.id, a.slug]))
  const categoryMap = new Map(categories.map((c) => [c.id, c.slug]))

  // 转换数据格式
  const posts = filteredData.map((post) => ({
    url: `/blog/${post.slugs.join('/')}`,
    path: post.path,
    slugs: post.slugs,
    data: {
      title: post.title,
      description: post.description,
      image: post.image,
      date: post.date,
      published: post.published ?? true,
      slug: post.slug,
      author: post.authorId ? (authorMap.get(post.authorId) ?? undefined) : undefined,
      categories: ((post.categoryIds as string[]) ?? []).map((id) => categoryMap.get(id)).filter(Boolean) as string[],
      estimatedTime: post.estimatedTime ?? undefined,
      locale: post.locale,
      content: post.content,
    },
  }))

  const totalPages = Math.ceil(total / limit)

  return {
    posts,
    total,
    totalPages,
  }
}
