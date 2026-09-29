import { and, count, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm'
import { db } from "@/lib/db"
import { authors, categories, personas, skills, workflowCategories, workflows } from "@workspace/db"
import type { Author } from './types'

export const authorsDataAccess = {
  // 获取作者列表（支持搜索、分页）
  getAuthors: async (params: {
    page?: number
    limit?: number
    search?: string
    verified?: boolean
  }): Promise<Author[]> => {
    const { page = 1, limit = 20, search, verified } = params

    const whereConditions = [eq(authors.status, 'active')]

    if (search) {
      whereConditions.push(or(like(authors.name, `%${search}%`), like(authors.username, `%${search}%`))!)
    }

    if (verified !== undefined) {
      whereConditions.push(eq(authors.verified, verified))
    }

    const result = await db
      .select({
        id: authors.id,
        name: authors.name,
        username: authors.username,
        avatar: authors.avatar,
        description: authors.description,
        bio: authors.bio,
        website: authors.website,
        twitter: authors.twitter,
        linkedin: authors.linkedin,
        github: authors.github,
        verified: authors.verified,
        status: authors.status,
        workflowCount: sql<number>`COALESCE(COUNT(${workflows.id}), 0)::int`.as('workflowCount'),
        createdAt: authors.createdAt,
        updatedAt: authors.updatedAt,
      })
      .from(authors)
      .leftJoin(workflows, and(eq(workflows.authorId, authors.id), eq(workflows.status, 'published')))
      .where(and(...whereConditions))
      .groupBy(authors.id)
      .orderBy(desc(sql`COALESCE(COUNT(${workflows.id}), 0)::int`))
      .limit(limit)
      .offset((page - 1) * limit)

    return result.map((item) => ({
      ...item,
      workflowCount: Number(item.workflowCount) || 0,
      skillCount: 0,
      personaCount: 0,
      hasLinks: !!(item.website || item.twitter || item.linkedin || item.github),
    }))
  },

  // 获取作者总数
  getAuthorsCount: async (params: { search?: string; verified?: boolean }): Promise<number> => {
    const { search, verified } = params

    const whereConditions = [eq(authors.status, 'active')]

    if (search) {
      whereConditions.push(or(like(authors.name, `%${search}%`), like(authors.username, `%${search}%`))!)
    }

    if (verified !== undefined) {
      whereConditions.push(eq(authors.verified, verified))
    }

    const result = await db
      .select({ count: count() })
      .from(authors)
      .where(and(...whereConditions))

    return result[0]?.count || 0
  },

  // 根据 slug (username) 获取作者详情
  getAuthorBySlug: async (slug: string): Promise<Author | null> => {
    const result = await db
      .select({
        id: authors.id,
        name: authors.name,
        username: authors.username,
        avatar: authors.avatar,
        description: authors.description,
        bio: authors.bio,
        website: authors.website,
        twitter: authors.twitter,
        linkedin: authors.linkedin,
        github: authors.github,
        verified: authors.verified,
        status: authors.status,
        workflowCount: sql<number>`COALESCE(COUNT(${workflows.id}), 0)::int`.as('workflowCount'),
        createdAt: authors.createdAt,
        updatedAt: authors.updatedAt,
      })
      .from(authors)
      .leftJoin(workflows, and(eq(workflows.authorId, authors.id), eq(workflows.status, 'published')))
      .where(and(eq(authors.username, slug), eq(authors.status, 'active')))
      .groupBy(authors.id)
      .limit(1)

    if (result.length === 0) {
      return null
    }

    const author = result[0]!
    const authorId = author.id

    const [skillCountRow, personaCountRow] = await Promise.all([
      db
        .select({ c: count() })
        .from(skills)
        .where(and(eq(skills.authorId, authorId), eq(skills.status, 'published'))),
      db
        .select({ c: count() })
        .from(personas)
        .where(and(eq(personas.authorId, authorId), eq(personas.status, 'published'))),
    ])

    return {
      ...author,
      workflowCount: Number(author.workflowCount) || 0,
      skillCount: skillCountRow[0]?.c ?? 0,
      personaCount: personaCountRow[0]?.c ?? 0,
      hasLinks: !!(author.website || author.twitter || author.linkedin || author.github),
    }
  },

  // 获取作者的工作流列表（支持过滤、排序、分页）
  getAuthorWorkflows: async (params: {
    authorSlug: string
    page?: number
    limit?: number
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc'
  }) => {
    const {
      authorSlug,
      page = 1,
      limit = 20,
      categorySlugs,
      priceType,
      complexity,
      timePeriod,
      sort = 'date-desc',
    } = params

    // 先获取作者ID
    const author = await db.select().from(authors).where(eq(authors.username, authorSlug)).limit(1)
    if (author.length === 0) {
      return []
    }
    const authorId = author[0]!.id

    // 构建时间过滤条件
    let timeFilter
    if (timePeriod && timePeriod !== 'all') {
      const now = new Date()
      const cutoffDate = new Date()
      switch (timePeriod) {
        case '7d':
          cutoffDate.setDate(now.getDate() - 7)
          break
        case '1m':
          cutoffDate.setMonth(now.getMonth() - 1)
          break
        case '3m':
          cutoffDate.setMonth(now.getMonth() - 3)
          break
      }
      timeFilter = gte(workflows.publishedAt, cutoffDate)
    }

    // 构建过滤条件
    const whereConditions = [eq(workflows.status, 'published'), eq(workflows.authorId, authorId)]

    if (priceType) {
      whereConditions.push(eq(workflows.priceType, priceType))
    }

    if (complexity) {
      whereConditions.push(eq(workflows.complexity, complexity))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    // 构建排序
    let orderBy
    switch (sort) {
      case 'date-asc':
        orderBy = workflows.publishedAt
        break
      case 'downloads-desc':
        orderBy = desc(workflows.downloads)
        break
      case 'views-desc':
        orderBy = desc(workflows.views)
        break
      case 'date-desc':
      default:
        orderBy = desc(workflows.publishedAt)
        break
    }

    // 如果指定了分类，使用 JOIN 来过滤，避免生成包含大量参数的 SQL 查询
    if (categorySlugs && categorySlugs.length > 0) {
      // 先验证分类是否存在且活跃
      const validCategories = await db
        .select({ slug: categories.slug, id: categories.id })
        .from(categories)
        .where(and(inArray(categories.slug, categorySlugs), eq(categories.isActive, true)))

      if (validCategories.length === 0) {
        return []
      }

      const validCategoryIds = validCategories.map((c) => c.id)

      const result = await db
        .selectDistinct({
          id: workflows.id,
          referenceId: workflows.referenceId,
          slug: workflows.slug,
          title: workflows.title,
          titleEn: workflows.titleEn,
          description: workflows.description,
          descriptionEn: workflows.descriptionEn,
          summary: workflows.summary,
          imageUrl: workflows.imageUrl,
          priceType: workflows.priceType,
          priceAmount: workflows.priceAmount,
          complexity: workflows.complexity,
          certified: workflows.certified,
          views: workflows.views,
          downloads: workflows.downloads,
          likes: workflows.likes,
          publishedAt: workflows.publishedAt,
          createdAt: workflows.createdAt,
        })
        .from(workflows)
        .innerJoin(workflowCategories, eq(workflowCategories.workflowId, workflows.id))
        .where(and(...whereConditions, inArray(workflowCategories.categoryId, validCategoryIds)))
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit)

      return result
    }

    // 没有分类过滤时，使用简单的查询
    const result = await db
      .select({
        id: workflows.id,
        referenceId: workflows.referenceId,
        slug: workflows.slug,
        title: workflows.title,
        titleEn: workflows.titleEn,
        description: workflows.description,
        descriptionEn: workflows.descriptionEn,
        summary: workflows.summary,
        imageUrl: workflows.imageUrl,
        priceType: workflows.priceType,
        priceAmount: workflows.priceAmount,
        complexity: workflows.complexity,
        certified: workflows.certified,
        views: workflows.views,
        downloads: workflows.downloads,
        likes: workflows.likes,
        publishedAt: workflows.publishedAt,
        createdAt: workflows.createdAt,
      })
      .from(workflows)
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    return result
  },

  // 获取作者的工作流总数
  getAuthorWorkflowsCount: async (params: {
    authorSlug: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    timePeriod?: '7d' | '1m' | '3m' | 'all'
  }): Promise<number> => {
    const { authorSlug, categorySlugs, priceType, complexity, timePeriod } = params

    // 先获取作者ID
    const author = await db.select().from(authors).where(eq(authors.username, authorSlug)).limit(1)
    if (author.length === 0) {
      return 0
    }
    const authorId = author[0]!.id

    // 构建时间过滤条件
    let timeFilter
    if (timePeriod && timePeriod !== 'all') {
      const now = new Date()
      const cutoffDate = new Date()
      switch (timePeriod) {
        case '7d':
          cutoffDate.setDate(now.getDate() - 7)
          break
        case '1m':
          cutoffDate.setMonth(now.getMonth() - 1)
          break
        case '3m':
          cutoffDate.setMonth(now.getMonth() - 3)
          break
      }
      timeFilter = gte(workflows.publishedAt, cutoffDate)
    }

    // 构建过滤条件
    const whereConditions = [eq(workflows.status, 'published'), eq(workflows.authorId, authorId)]

    if (priceType) {
      whereConditions.push(eq(workflows.priceType, priceType))
    }

    if (complexity) {
      whereConditions.push(eq(workflows.complexity, complexity))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    // 如果指定了分类，使用 JOIN 来过滤，避免生成包含大量参数的 SQL 查询
    if (categorySlugs && categorySlugs.length > 0) {
      // 先验证分类是否存在且活跃
      const validCategories = await db
        .select({ slug: categories.slug, id: categories.id })
        .from(categories)
        .where(and(inArray(categories.slug, categorySlugs), eq(categories.isActive, true)))

      if (validCategories.length === 0) {
        return 0
      }

      const validCategoryIds = validCategories.map((c) => c.id)

      const result = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${workflows.id})`.as('count') })
        .from(workflows)
        .innerJoin(workflowCategories, eq(workflowCategories.workflowId, workflows.id))
        .where(and(...whereConditions, inArray(workflowCategories.categoryId, validCategoryIds)))

      return Number(result[0]?.count) || 0
    }

    // 没有分类过滤时，使用简单的查询
    const result = await db.select({ count: count() }).from(workflows).where(and(...whereConditions))

    return result[0]?.count || 0
  },

  // 获取作者工作流的所有分类（去重，只返回活跃分类）
  getAuthorWorkflowCategories: async (authorSlug: string): Promise<Array<{ slug: string; name: string; nameEn: string }>> => {
    // 使用一次JOIN查询，从authors -> workflows -> workflowCategories -> categories
    // 只返回作者有工作流的活跃分类
    const categoriesData = await db
      .selectDistinct({
        slug: categories.slug,
        name: categories.name,
        nameEn: categories.nameEn,
      })
      .from(authors)
      .innerJoin(workflows, and(eq(workflows.authorId, authors.id), eq(workflows.status, 'published')))
      .innerJoin(workflowCategories, eq(workflowCategories.workflowId, workflows.id))
      .innerJoin(categories, and(eq(workflowCategories.categoryId, categories.id), eq(categories.isActive, true)))
      .where(eq(authors.username, authorSlug))

    return categoriesData
  },

  getAuthorSkillCategories: async (authorSlug: string): Promise<Array<{ slug: string; name: string; nameEn: string }>> => {
    const categoriesData = await db
      .selectDistinct({
        slug: categories.slug,
        name: categories.name,
        nameEn: categories.nameEn,
      })
      .from(authors)
      .innerJoin(skills, and(eq(skills.authorId, authors.id), eq(skills.status, 'published')))
      .innerJoin(categories, and(eq(skills.categoryId, categories.id), eq(categories.isActive, true)))
      .where(eq(authors.username, authorSlug))

    return categoriesData
  },

  getAuthorPersonaCategories: async (authorSlug: string): Promise<Array<{ slug: string; name: string; nameEn: string }>> => {
    const categoriesData = await db
      .selectDistinct({
        slug: categories.slug,
        name: categories.name,
        nameEn: categories.nameEn,
      })
      .from(authors)
      .innerJoin(personas, and(eq(personas.authorId, authors.id), eq(personas.status, 'published')))
      .innerJoin(categories, and(eq(personas.categoryId, categories.id), eq(categories.isActive, true)))
      .where(eq(authors.username, authorSlug))

    return categoriesData
  },
}
