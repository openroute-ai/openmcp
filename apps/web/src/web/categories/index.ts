import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from "@/lib/db"
import { categories, workflowCategories, workflows } from "@workspace/db"
import { getLocalizedCategory, getLocalizedWorkflow } from "@/lib/i18n/fields"
import type { Category } from './types'

export const categoriesDataAccess = {
  // 获取所有分类（带工作流数量统计）
  getAllCategories: async (locale: 'zh' | 'en' = 'zh'): Promise<Category[]> => {
    const result = await db
      .select({
        id: categories.id,
        referenceId: categories.referenceId,
        name: categories.name,
        nameEn: categories.nameEn,
        slug: categories.slug,
        description: categories.description,
        descriptionEn: categories.descriptionEn,
        icon: categories.icon,
        order: categories.order,
        isActive: categories.isActive,
        workflowCount: sql<number>`COALESCE(COUNT(${workflowCategories.id}), 0)::int`.as('workflowCount'),
        createdAt: categories.createdAt,
        updatedAt: categories.updatedAt,
      })
      .from(categories)
      .leftJoin(workflowCategories, eq(categories.id, workflowCategories.categoryId))
      .leftJoin(workflows, and(eq(workflowCategories.workflowId, workflows.id), eq(workflows.status, 'published')))
      .where(eq(categories.isActive, true))
      .groupBy(categories.id)
      .orderBy(categories.order, categories.name)

    return result.map((item) => {
      const category = {
        ...item,
        workflowCount: Number(item.workflowCount) || 0,
      }
      return getLocalizedCategory(category, locale)
    })
  },

  // 根据 slug 获取分类详情
  getCategoryBySlug: async (slug: string, locale: 'zh' | 'en' = 'zh'): Promise<Category | null> => {
    const result = await db
      .select({
        id: categories.id,
        referenceId: categories.referenceId,
        name: categories.name,
        nameEn: categories.nameEn,
        slug: categories.slug,
        description: categories.description,
        descriptionEn: categories.descriptionEn,
        icon: categories.icon,
        order: categories.order,
        isActive: categories.isActive,
        workflowCount: sql<number>`COALESCE(COUNT(${workflowCategories.id}), 0)::int`.as('workflowCount'),
        createdAt: categories.createdAt,
        updatedAt: categories.updatedAt,
      })
      .from(categories)
      .leftJoin(workflowCategories, eq(categories.id, workflowCategories.categoryId))
      .leftJoin(workflows, and(eq(workflowCategories.workflowId, workflows.id), eq(workflows.status, 'published')))
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .groupBy(categories.id)
      .limit(1)

    if (result.length === 0) {
      return null
    }

    const row = result[0]!
    const category = {
      ...row,
      workflowCount: Number(row.workflowCount) || 0,
    }
    return getLocalizedCategory(category, locale)
  },

  // 获取分类下的工作流列表（支持过滤、排序、分页）
  getCategoryWorkflows: async (params: {
    categorySlug: string
    page?: number
    limit?: number
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    nodeTypes?: string[]
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc'
    locale?: 'zh' | 'en'
  }) => {
    const {
      categorySlug,
      page = 1,
      limit = 20,
      priceType,
      complexity,
      nodeTypes,
      timePeriod,
      sort = 'date-desc',
      locale = 'zh',
    } = params

    // 先获取分类ID
    const category = await db.select().from(categories).where(eq(categories.slug, categorySlug)).limit(1)
    if (category.length === 0) {
      return []
    }
    const categoryId = category[0]!.id

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
    const whereConditions = [eq(workflows.status, 'published'), eq(workflowCategories.categoryId, categoryId)]

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

    // 如果指定了节点类型，需要先过滤
    let workflowIds: string[] | undefined
    if (nodeTypes && nodeTypes.length > 0) {
      const { workflowNodes } = await import("@workspace/db")
      const nodeWorkflows = await db
        .selectDistinct({ workflowId: workflowNodes.workflowId })
        .from(workflowNodes)
        .where(inArray(workflowNodes.nodeType, nodeTypes))
      workflowIds = nodeWorkflows.map((w) => w.workflowId)
      if (workflowIds.length === 0) {
        return []
      }
      whereConditions.push(inArray(workflows.id, workflowIds))
    }

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
      .innerJoin(workflowCategories, eq(workflows.id, workflowCategories.workflowId))
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    // 应用本地化
    return result.map((workflow) => ({
      ...workflow,
      ...getLocalizedWorkflow(
        {
          title: workflow.title,
          titleEn: workflow.titleEn,
          description: workflow.description,
          descriptionEn: workflow.descriptionEn,
          summary: workflow.summary,
          readme: null,
          readmeEn: null,
        },
        locale
      ),
    }))
  },

  // 获取分类下的工作流总数
  getCategoryWorkflowsCount: async (params: {
    categorySlug: string
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    nodeTypes?: string[]
    timePeriod?: '7d' | '1m' | '3m' | 'all'
  }): Promise<number> => {
    const { categorySlug, priceType, complexity, nodeTypes, timePeriod } = params

    // 先获取分类ID
    const category = await db.select().from(categories).where(eq(categories.slug, categorySlug)).limit(1)
    if (category.length === 0) {
      return 0
    }
    const categoryId = category[0]!.id

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
    const whereConditions = [eq(workflows.status, 'published'), eq(workflowCategories.categoryId, categoryId)]

    if (priceType) {
      whereConditions.push(eq(workflows.priceType, priceType))
    }

    if (complexity) {
      whereConditions.push(eq(workflows.complexity, complexity))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    // 如果指定了节点类型，需要先过滤
    if (nodeTypes && nodeTypes.length > 0) {
      const { workflowNodes } = await import("@workspace/db")
      const nodeWorkflows = await db
        .selectDistinct({ workflowId: workflowNodes.workflowId })
        .from(workflowNodes)
        .where(inArray(workflowNodes.nodeType, nodeTypes))
      const workflowIds = nodeWorkflows.map((w) => w.workflowId)
      if (workflowIds.length === 0) {
        return 0
      }
      whereConditions.push(inArray(workflows.id, workflowIds))
    }

    const result = await db
      .select({ count: count() })
      .from(workflows)
      .innerJoin(workflowCategories, eq(workflows.id, workflowCategories.workflowId))
      .where(and(...whereConditions))

    return result[0]?.count || 0
  },
}
