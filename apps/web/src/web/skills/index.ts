import { and, count, desc, eq, gte, inArray, like, ne, or, sql } from 'drizzle-orm'
import { db } from "@/lib/db"
import { authors, categories, skills, skillViews } from "@workspace/db"
import { type OpenmcpEvalReportV1, parseEvalReport } from "@/lib/skills/eval-report"

type SkillListItem = {
  id: string
  referenceId: string
  slug: string
  title: string
  titleEn: string | null
  description: string
  descriptionEn: string | null
  imageUrl: string | null
  priceType: 'free' | 'paid'
  certified: boolean
  views: number
  downloads: number
  likes: number
  publishedAt: Date | null
  createdAt: Date
  author: {
    id: string
    name: string
    username: string
    avatar: string | null
    verified: boolean
  }
  category: {
    id: string
    name: string
    nameEn: string
    slug: string
  } | null
}

function localizeSkill(
  row: { title: string | null; titleEn: string | null; description: string | null; descriptionEn: string | null },
  locale: 'zh' | 'en'
) {
  return {
    title: locale === 'zh' ? row.title || row.titleEn || '' : row.titleEn || row.title || '',
    description:
      locale === 'zh' ? row.description || row.descriptionEn || '' : row.descriptionEn || row.description || '',
  }
}

export const skillsDataAccess = {
  getSkills: async (params: {
    page?: number
    limit?: number
    search?: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    certified?: boolean
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'popularity-desc'
    locale?: 'zh' | 'en'
    /** 仅某作者（username）下的技能 */
    authorUsername?: string
  }): Promise<SkillListItem[]> => {
    const {
      page = 1,
      limit = 20,
      search,
      categorySlugs,
      priceType,
      certified,
      timePeriod,
      sort = 'date-desc',
      locale = 'zh',
      authorUsername,
    } = params

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
      timeFilter = gte(skills.publishedAt, cutoffDate)
    }

    const whereConditions = [eq(skills.status, 'published')]

    if (authorUsername) {
      whereConditions.push(eq(authors.username, authorUsername))
    }

    if (search) {
      whereConditions.push(
        or(
          like(skills.title, `%${search}%`),
          like(skills.description, `%${search}%`),
          like(authors.name, `%${search}%`),
          like(authors.username, `%${search}%`)
        )!
      )
    }

    if (priceType) {
      whereConditions.push(eq(skills.priceType, priceType))
    }

    if (certified !== undefined) {
      whereConditions.push(eq(skills.certified, certified))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    let categoryIds: string[] | undefined
    if (categorySlugs && categorySlugs.length > 0) {
      const catRows = await db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.slug, categorySlugs))
      categoryIds = catRows.map((c) => c.id)
      if (categoryIds.length > 0) {
        whereConditions.push(inArray(skills.categoryId, categoryIds))
      }
    }

    let orderBy
    switch (sort) {
      case 'date-asc':
        orderBy = skills.publishedAt
        break
      case 'downloads-desc':
        orderBy = desc(skills.downloads)
        break
      case 'views-desc':
        orderBy = desc(skills.views)
        break
      case 'popularity-desc':
        orderBy = desc(skills.popularity)
        break
      case 'date-desc':
      default:
        orderBy = desc(skills.publishedAt)
        break
    }

    const q = db
      .select({
        id: skills.id,
        referenceId: skills.referenceId,
        slug: skills.slug,
        title: skills.title,
        titleEn: skills.titleEn,
        description: skills.description,
        descriptionEn: skills.descriptionEn,
        imageUrl: skills.imageUrl,
        priceType: skills.priceType,
        certified: skills.certified,
        views: skills.views,
        downloads: skills.downloads,
        likes: skills.likes,
        publishedAt: skills.publishedAt,
        createdAt: skills.createdAt,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
        category: {
          id: categories.id,
          name: categories.name,
          nameEn: categories.nameEn,
          slug: categories.slug,
        },
      })
      .from(skills)
      .innerJoin(authors, eq(skills.authorId, authors.id))
      .leftJoin(categories, eq(skills.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    const result = await q

    return result.map((row) => {
      const localized = localizeSkill(row, locale)
      const category =
        row.category?.id != null
          ? { id: row.category.id, name: row.category.name, nameEn: row.category.nameEn, slug: row.category.slug }
          : null
      return {
        ...row,
        ...localized,
        category,
      }
    })
  },

  getSkillsCount: async (params: {
    search?: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    certified?: boolean
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    authorUsername?: string
  }): Promise<number> => {
    const { search, categorySlugs, priceType, certified, timePeriod, authorUsername } = params

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
      timeFilter = gte(skills.publishedAt, cutoffDate)
    }

    const whereConditions = [eq(skills.status, 'published')]

    if (authorUsername) {
      whereConditions.push(eq(authors.username, authorUsername))
    }

    if (search) {
      whereConditions.push(
        or(
          like(skills.title, `%${search}%`),
          like(skills.description, `%${search}%`),
          like(authors.name, `%${search}%`),
          like(authors.username, `%${search}%`)
        )!
      )
    }

    if (priceType) {
      whereConditions.push(eq(skills.priceType, priceType))
    }

    if (certified !== undefined) {
      whereConditions.push(eq(skills.certified, certified))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    if (categorySlugs && categorySlugs.length > 0) {
      const catRows = await db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.slug, categorySlugs))
      const categoryIds = catRows.map((c) => c.id)
      if (categoryIds.length > 0) {
        whereConditions.push(inArray(skills.categoryId, categoryIds))
      }
    }

    const [row] = await db
      .select({ count: count() })
      .from(skills)
      .innerJoin(authors, eq(skills.authorId, authors.id))
      .where(and(...whereConditions))

    return row?.count ?? 0
  },

  getSkillById: async (
    id: string,
    locale: 'zh' | 'en' = 'zh'
  ): Promise<{
    id: string
    referenceId: string
    slug: string
    title: string
    titleEn: string | null
    description: string | null
    descriptionEn: string | null
    summary: string | null
    imageUrl: string | null
    readme: string | null
    readmeEn: string | null
    priceType: 'free' | 'paid'
    priceAmount: string | null
    billingModel: 'one_time' | 'subscription' | 'pay_per_call' | null
    currency: string | null
    mcpSchemaVersion: string | null
    certified: boolean
    certifiedAt: Date | null
    views: number
    downloads: number
    likes: number
    publishedAt: Date | null
    createdAt: Date
    updatedAt: Date
    version: string | null
    features: string[] | null
    scenario: string | null
    platforms: unknown
    githubUrl: string | null
    sourceType: 'github' | 'zip' | null
    securityGrade: 'safe' | 'caution' | 'unsafe' | 'reject' | 'unknown' | null
    securityFlags: unknown[] | null
    securityLlmGrade: string | null
    securityLlmAnalysis: unknown
    trustTier: number | null
    scannedAt: Date | null
    scanRulesVersion: string | null
    evalReport: OpenmcpEvalReportV1 | null
    author: { id: string; name: string; username: string; avatar: string | null; verified: boolean }
    category: { id: string; name: string; nameEn: string; slug: string } | null
  } | null> => {
    const [row] = await db
      .select({
        id: skills.id,
        referenceId: skills.referenceId,
        slug: skills.slug,
        title: skills.title,
        titleEn: skills.titleEn,
        description: skills.description,
        descriptionEn: skills.descriptionEn,
        summary: skills.summary,
        metaDescription: skills.metaDescription,
        imageUrl: skills.imageUrl,
        readme: skills.readme,
        readmeEn: skills.readmeEn,
        priceType: skills.priceType,
        priceAmount: skills.priceAmount,
        billingModel: skills.billingModel,
        currency: skills.currency,
        mcpSchemaVersion: skills.mcpSchemaVersion,
        certified: skills.certified,
        certifiedAt: skills.certifiedAt,
        views: skills.views,
        downloads: skills.downloads,
        likes: skills.likes,
        publishedAt: skills.publishedAt,
        createdAt: skills.createdAt,
        updatedAt: skills.updatedAt,
        version: skills.version,
        features: skills.features,
        scenario: skills.scenario,
        platforms: skills.platforms,
        githubUrl: skills.githubUrl,
        sourceType: skills.sourceType,
        securityGrade: skills.securityGrade,
        securityFlags: skills.securityFlags,
        securityLlmGrade: skills.securityLlmGrade,
        securityLlmAnalysis: skills.securityLlmAnalysis,
        trustTier: skills.trustTier,
        scannedAt: skills.scannedAt,
        scanRulesVersion: skills.scanRulesVersion,
        metadata: skills.metadata,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
        categoryId: skills.categoryId,
      })
      .from(skills)
      .innerJoin(authors, eq(skills.authorId, authors.id))
      .where(and(eq(skills.id, id), eq(skills.status, 'published')))
      .limit(1)

    if (!row) return null

    let category: { id: string; name: string; nameEn: string; slug: string } | null = null
    if (row.categoryId) {
      const [c] = await db
        .select({ id: categories.id, name: categories.name, nameEn: categories.nameEn, slug: categories.slug })
        .from(categories)
        .where(eq(categories.id, row.categoryId))
        .limit(1)
      category = c ?? null
    }

    const localized = localizeSkill(row, locale)
    const readme = locale === 'zh' ? row.readme || row.readmeEn : row.readmeEn || row.readme

    return {
      ...row,
      title: localized.title,
      description: localized.description,
      readme,
      readmeEn: row.readmeEn,
      priceAmount: row.priceAmount?.toString() ?? null,
      billingModel: row.billingModel ?? null,
      currency: row.currency ?? 'CNY',
      mcpSchemaVersion: row.mcpSchemaVersion ?? null,
      certifiedAt: row.certifiedAt ?? null,
      version: row.version ?? null,
      features: Array.isArray(row.features) ? row.features : null,
      scenario: row.scenario ?? null,
      platforms: row.platforms ?? [],
      githubUrl: row.githubUrl ?? null,
      sourceType: row.sourceType ?? null,
      securityGrade: row.securityGrade ?? 'unknown',
      securityFlags: Array.isArray(row.securityFlags) ? row.securityFlags : null,
      securityLlmGrade: row.securityLlmGrade ?? null,
      securityLlmAnalysis: row.securityLlmAnalysis ?? null,
      trustTier: row.trustTier ?? null,
      scannedAt: row.scannedAt ?? null,
      scanRulesVersion: row.scanRulesVersion ?? null,
      evalReport: parseEvalReport(row.metadata),
      author: row.author,
      category,
    }
  },

  getSkillBySlug: async (slug: string, locale: 'zh' | 'en' = 'zh') => {
    const [row] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.slug, slug), eq(skills.status, 'published')))
      .limit(1)
    if (!row) return null
    return skillsDataAccess.getSkillById(row.id, locale)
  },

  /** 相关技能：优先同分类，其次按热度，返回 SkillListItem 以复用前端展示 */
  getRelatedSkills: async (params: {
    skillId: string
    limit?: number
    locale?: 'zh' | 'en'
  }): Promise<SkillListItem[]> => {
    const { skillId, limit = 6, locale = 'zh' } = params

    const [current] = await db
      .select({ categoryId: skills.categoryId })
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1)

    const whereConditions = [eq(skills.status, 'published'), ne(skills.id, skillId)]
    if (current?.categoryId) {
      whereConditions.push(eq(skills.categoryId, current.categoryId))
    }

    const result = await db
      .select({
        id: skills.id,
        referenceId: skills.referenceId,
        slug: skills.slug,
        title: skills.title,
        titleEn: skills.titleEn,
        description: skills.description,
        descriptionEn: skills.descriptionEn,
        imageUrl: skills.imageUrl,
        priceType: skills.priceType,
        certified: skills.certified,
        views: skills.views,
        downloads: skills.downloads,
        likes: skills.likes,
        publishedAt: skills.publishedAt,
        createdAt: skills.createdAt,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
        category: {
          id: categories.id,
          name: categories.name,
          nameEn: categories.nameEn,
          slug: categories.slug,
        },
      })
      .from(skills)
      .innerJoin(authors, eq(skills.authorId, authors.id))
      .leftJoin(categories, eq(skills.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(desc(skills.popularity))
      .limit(limit * 2)

    return result.map((row) => {
      const localized = localizeSkill(row, locale)
      const category =
        row.category?.id != null
          ? { id: row.category.id, name: row.category.name, nameEn: row.category.nameEn, slug: row.category.slug }
          : null
      return { ...row, ...localized, category }
    })
  },

  incrementViews: async (skillId: string) => {
    await db
      .update(skills)
      .set({ views: sql`${skills.views} + 1` })
      .where(eq(skills.id, skillId))
    await db.insert(skillViews).values({ skillId, viewedAt: new Date() })
  },
}
