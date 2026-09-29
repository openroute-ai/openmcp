import { and, count, desc, eq, like, or } from 'drizzle-orm'
import { db } from "@/lib/db"
import { mcpTools, skills } from "@workspace/db"

type McpToolListItem = {
  id: string
  skillId: string
  toolName: string
  nameEn: string | null
  description: string | null
  descriptionEn: string | null
  isDeprecated: boolean
  createdAt: Date
  skill: {
    id: string
    slug: string
    title: string | null
    titleEn: string | null
  }
}

function localizeTool(
  row: {
    toolName: string
    nameEn: string | null
    description: string | null
    descriptionEn: string | null
  },
  locale: 'zh' | 'en'
) {
  return {
    toolName: row.toolName,
    name: locale === 'zh' ? row.toolName || row.nameEn || '' : row.nameEn || row.toolName || '',
    description:
      locale === 'zh' ? row.description || row.descriptionEn || '' : row.descriptionEn || row.description || '',
  }
}

export const mcpToolsDataAccess = {
  getMcpTools: async (params: {
    page?: number
    limit?: number
    search?: string
    skillId?: string
    includeDeprecated?: boolean
    sort?: 'date-desc' | 'date-asc' | 'name-asc'
    locale?: 'zh' | 'en'
  }): Promise<McpToolListItem[]> => {
    const {
      page = 1,
      limit = 20,
      search,
      skillId,
      includeDeprecated = false,
      sort = 'date-desc',
      locale = 'zh',
    } = params

    const whereConditions = []

    if (!includeDeprecated) {
      whereConditions.push(eq(mcpTools.isDeprecated, false))
    }

    if (skillId) {
      whereConditions.push(eq(mcpTools.skillId, skillId))
    }

    if (search) {
      whereConditions.push(
        or(
          like(mcpTools.toolName, `%${search}%`),
          like(mcpTools.nameEn, `%${search}%`),
          like(mcpTools.description, `%${search}%`),
          like(mcpTools.descriptionEn, `%${search}%`)
        )!
      )
    }

    const orderBy =
      sort === 'date-asc'
        ? mcpTools.createdAt
        : sort === 'name-asc'
          ? mcpTools.toolName
          : desc(mcpTools.createdAt)

    let query = db
      .select({
        id: mcpTools.id,
        skillId: mcpTools.skillId,
        toolName: mcpTools.toolName,
        nameEn: mcpTools.nameEn,
        description: mcpTools.description,
        descriptionEn: mcpTools.descriptionEn,
        isDeprecated: mcpTools.isDeprecated,
        createdAt: mcpTools.createdAt,
        skill: {
          id: skills.id,
          slug: skills.slug,
          title: skills.title,
          titleEn: skills.titleEn,
        },
      })
      .from(mcpTools)
      .innerJoin(skills, eq(mcpTools.skillId, skills.id))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    if (whereConditions.length > 0) {
      query = query.where(and(...whereConditions)) as typeof query
    }

    const result = await query

    return result.map((row) => {
      const localized = localizeTool(row, locale)
      return {
        ...row,
        ...localized,
        skill: row.skill,
      }
    })
  },

  getMcpToolsCount: async (params: {
    search?: string
    skillId?: string
    includeDeprecated?: boolean
  }): Promise<number> => {
    const { search, skillId, includeDeprecated = false } = params

    const whereConditions = []

    if (!includeDeprecated) {
      whereConditions.push(eq(mcpTools.isDeprecated, false))
    }

    if (skillId) {
      whereConditions.push(eq(mcpTools.skillId, skillId))
    }

    if (search) {
      whereConditions.push(
        or(
          like(mcpTools.toolName, `%${search}%`),
          like(mcpTools.nameEn, `%${search}%`),
          like(mcpTools.description, `%${search}%`),
          like(mcpTools.descriptionEn, `%${search}%`)
        )!
      )
    }

    let countQuery = db.select({ count: count() }).from(mcpTools)
    if (whereConditions.length > 0) {
      countQuery = countQuery.where(and(...whereConditions)) as typeof countQuery
    }
    const [row] = await countQuery

    return row?.count ?? 0
  },

  getMcpToolById: async (
    id: string,
    locale: 'zh' | 'en' = 'zh'
  ): Promise<{
    id: string
    skillId: string
    toolName: string
    name: string
    nameEn: string | null
    description: string
    descriptionEn: string | null
    inputSchema: unknown
    outputSchema: unknown
    isDeprecated: boolean
    createdAt: Date
    skill: {
      id: string
      slug: string
      title: string | null
      titleEn: string | null
    }
  } | null> => {
    const [row] = await db
      .select({
        id: mcpTools.id,
        skillId: mcpTools.skillId,
        toolName: mcpTools.toolName,
        nameEn: mcpTools.nameEn,
        description: mcpTools.description,
        descriptionEn: mcpTools.descriptionEn,
        inputSchema: mcpTools.inputSchema,
        outputSchema: mcpTools.outputSchema,
        isDeprecated: mcpTools.isDeprecated,
        createdAt: mcpTools.createdAt,
        skill: {
          id: skills.id,
          slug: skills.slug,
          title: skills.title,
          titleEn: skills.titleEn,
        },
      })
      .from(mcpTools)
      .innerJoin(skills, eq(mcpTools.skillId, skills.id))
      .where(eq(mcpTools.id, id))
      .limit(1)

    if (!row) return null

    const localized = localizeTool(row, locale)
    return {
      ...row,
      ...localized,
      skill: row.skill,
    }
  },
}
