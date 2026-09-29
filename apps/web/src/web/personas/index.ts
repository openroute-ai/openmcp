import { and, count, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm'
import { db } from "@/lib/db"
import { authors, categories, personas, personaViews } from "@workspace/db"

type PersonaListItem = {
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
  metadata: unknown
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

function localizePersona(
  row: { title: string | null; titleEn: string | null; description: string | null; descriptionEn: string | null },
  locale: 'zh' | 'en'
) {
  return {
    title: locale === 'zh' ? row.title || row.titleEn || '' : row.titleEn || row.title || '',
    description:
      locale === 'zh' ? row.description || row.descriptionEn || '' : row.descriptionEn || row.description || '',
  }
}

export const personasDataAccess = {
  getPersonas: async (params: {
    page?: number
    limit?: number
    search?: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    certified?: boolean
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'likes-desc'
    locale?: 'zh' | 'en'
    authorUsername?: string
  }): Promise<PersonaListItem[]> => {
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
      timeFilter = gte(personas.publishedAt, cutoffDate)
    }

    const whereConditions = [eq(personas.status, 'published')]

    if (authorUsername) {
      whereConditions.push(eq(authors.username, authorUsername))
    }

    if (search) {
      whereConditions.push(
        or(
          like(personas.title, `%${search}%`),
          like(personas.description, `%${search}%`),
          like(authors.name, `%${search}%`),
          like(authors.username, `%${search}%`)
        )!
      )
    }

    if (priceType) {
      whereConditions.push(eq(personas.priceType, priceType))
    }

    if (certified !== undefined) {
      whereConditions.push(eq(personas.certified, certified))
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
        whereConditions.push(inArray(personas.categoryId, categoryIds))
      }
    }

    let orderBy
    switch (sort) {
      case 'date-asc':
        orderBy = personas.publishedAt
        break
      case 'downloads-desc':
        orderBy = desc(personas.downloads)
        break
      case 'views-desc':
        orderBy = desc(personas.views)
        break
      case 'likes-desc':
        orderBy = desc(personas.likes)
        break
      case 'date-desc':
      default:
        orderBy = desc(personas.publishedAt)
        break
    }

    const result = await db
      .select({
        id: personas.id,
        referenceId: personas.referenceId,
        slug: personas.slug,
        title: personas.title,
        titleEn: personas.titleEn,
        description: personas.description,
        descriptionEn: personas.descriptionEn,
        imageUrl: personas.imageUrl,
        priceType: personas.priceType,
        certified: personas.certified,
        views: personas.views,
        downloads: personas.downloads,
        likes: personas.likes,
        publishedAt: personas.publishedAt,
        createdAt: personas.createdAt,
        metadata: personas.metadata,
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
      .from(personas)
      .innerJoin(authors, eq(personas.authorId, authors.id))
      .leftJoin(categories, eq(personas.categoryId, categories.id))
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    return result.map((row) => {
      const localized = localizePersona(row, locale)
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

  getPersonasCount: async (params: {
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
      timeFilter = gte(personas.publishedAt, cutoffDate)
    }

    const whereConditions = [eq(personas.status, 'published')]

    if (authorUsername) {
      whereConditions.push(eq(authors.username, authorUsername))
    }

    if (search) {
      whereConditions.push(
        or(
          like(personas.title, `%${search}%`),
          like(personas.description, `%${search}%`),
          like(authors.name, `%${search}%`),
          like(authors.username, `%${search}%`)
        )!
      )
    }

    if (priceType) {
      whereConditions.push(eq(personas.priceType, priceType))
    }

    if (certified !== undefined) {
      whereConditions.push(eq(personas.certified, certified))
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
        whereConditions.push(inArray(personas.categoryId, categoryIds))
      }
    }

    const [row] = await db
      .select({ count: count() })
      .from(personas)
      .innerJoin(authors, eq(personas.authorId, authors.id))
      .where(and(...whereConditions))

    return row?.count ?? 0
  },

  getPersonaById: async (
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
    imageUrl: string | null
    priceType: 'free' | 'paid'
    priceAmount: string | null
    certified: boolean
    views: number
    downloads: number
    likes: number
    publishedAt: Date | null
    createdAt: Date
    updatedAt: Date
    promptConfig: unknown
    memoryConfig: unknown
    deploymentProfile: unknown
    metadata: unknown
    author: { id: string; name: string; username: string; avatar: string | null; verified: boolean }
    category: { id: string; name: string; nameEn: string; slug: string } | null
  } | null> => {
    const [row] = await db
      .select({
        id: personas.id,
        referenceId: personas.referenceId,
        slug: personas.slug,
        title: personas.title,
        titleEn: personas.titleEn,
        description: personas.description,
        descriptionEn: personas.descriptionEn,
        imageUrl: personas.imageUrl,
        priceType: personas.priceType,
        priceAmount: personas.priceAmount,
        certified: personas.certified,
        views: personas.views,
        downloads: personas.downloads,
        likes: personas.likes,
        publishedAt: personas.publishedAt,
        createdAt: personas.createdAt,
        updatedAt: personas.updatedAt,
        promptConfig: personas.promptConfig,
        memoryConfig: personas.memoryConfig,
        deploymentProfile: personas.deploymentProfile,
        metadata: personas.metadata,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
        categoryId: personas.categoryId,
      })
      .from(personas)
      .innerJoin(authors, eq(personas.authorId, authors.id))
      .where(eq(personas.id, id))
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

    const localized = localizePersona(row, locale)

    return {
      ...row,
      title: localized.title,
      description: localized.description,
      priceAmount: row.priceAmount?.toString() ?? null,
      author: row.author,
      category,
    }
  },

  getPersonaBySlug: async (slug: string, locale: 'zh' | 'en' = 'zh') => {
    const [row] = await db.select({ id: personas.id }).from(personas).where(eq(personas.slug, slug)).limit(1)
    if (!row) return null
    return personasDataAccess.getPersonaById(row.id, locale)
  },

  incrementViews: async (personaId: string) => {
    await db
      .update(personas)
      .set({ views: sql`${personas.views} + 1` })
      .where(eq(personas.id, personaId))
    await db.insert(personaViews).values({ personaId, viewedAt: new Date() })
  },
}
