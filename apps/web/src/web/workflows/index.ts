import { and, count, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm'
import { db } from "@/lib/db"
import { authors, categories, workflowCategories, workflowDownloads, workflowNodes, workflows } from "@workspace/db"
import { getLocalizedWorkflow } from "@/lib/i18n/fields"
import type { Workflow } from './types'

export const workflowsDataAccess = {
  // 获取工作流列表（支持过滤、排序、分页）
  getWorkflows: async (params: {
    page?: number
    limit?: number
    search?: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    nodeTypes?: string[]
    certified?: boolean
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'popularity-desc'
    locale?: 'zh' | 'en'
  }) => {
    const {
      page = 1,
      limit = 20,
      search,
      categorySlugs,
      priceType,
      complexity,
      nodeTypes,
      certified,
      timePeriod,
      sort = 'date-desc',
      locale = 'zh',
    } = params

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
    const whereConditions = [eq(workflows.status, 'published')]

    if (search) {
      whereConditions.push(
        or(
          like(workflows.title, `%${search}%`),
          like(workflows.description, `%${search}%`),
          like(authors.name, `%${search}%`),
          like(authors.username, `%${search}%`)
        )!
      )
    }

    if (priceType) {
      whereConditions.push(eq(workflows.priceType, priceType))
    }

    if (complexity) {
      whereConditions.push(eq(workflows.complexity, complexity))
    }

    if (certified !== undefined) {
      whereConditions.push(eq(workflows.certified, certified))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    // 如果指定了分类，需要先过滤
    let workflowIds: string[] | undefined
    if (categorySlugs && categorySlugs.length > 0) {
      const categoryList = await db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.slug, categorySlugs))
      const categoryIds = categoryList.map((c) => c.id)
      if (categoryIds.length > 0) {
        const categoryWorkflows = await db
          .selectDistinct({ workflowId: workflowCategories.workflowId })
          .from(workflowCategories)
          .where(inArray(workflowCategories.categoryId, categoryIds))
        workflowIds = categoryWorkflows.map((w) => w.workflowId)
        if (workflowIds.length === 0) {
          return []
        }
        whereConditions.push(inArray(workflows.id, workflowIds))
      }
    }

    // 如果指定了节点类型，需要先过滤
    if (nodeTypes && nodeTypes.length > 0) {
      const nodeWorkflows = await db
        .selectDistinct({ workflowId: workflowNodes.workflowId })
        .from(workflowNodes)
        .where(inArray(workflowNodes.nodeType, nodeTypes))
      const nodeWorkflowIds = nodeWorkflows.map((w) => w.workflowId)
      if (nodeWorkflowIds.length === 0) {
        return []
      }
      if (workflowIds) {
        workflowIds = workflowIds.filter((id) => nodeWorkflowIds.includes(id))
        if (workflowIds.length === 0) {
          return []
        }
        whereConditions.pop() // 移除之前的 inArray
        whereConditions.push(inArray(workflows.id, workflowIds))
      } else {
        whereConditions.push(inArray(workflows.id, nodeWorkflowIds))
      }
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
      case 'popularity-desc':
        orderBy = desc(workflows.popularity)
        break
      case 'date-desc':
      default:
        orderBy = desc(workflows.publishedAt)
        break
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
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
      })
      .from(workflows)
      .innerJoin(authors, eq(workflows.authorId, authors.id))
      .where(and(...whereConditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    // 获取每个工作流的分类和节点类型
    const resultWorkflowIds = result.map((w) => w.id)
    if (resultWorkflowIds.length === 0) {
      return []
    }
    const [categoriesData, nodesData] = await Promise.all([
      db
        .select({
          workflowId: workflowCategories.workflowId,
          category: {
            id: categories.id,
            name: categories.name,
            nameEn: categories.nameEn,
            slug: categories.slug,
          },
        })
        .from(workflowCategories)
        .innerJoin(categories, eq(workflowCategories.categoryId, categories.id))
        .where(inArray(workflowCategories.workflowId, resultWorkflowIds)),
      db
        .select({
          workflowId: workflowNodes.workflowId,
          nodeType: workflowNodes.nodeType,
        })
        .from(workflowNodes)
        .where(inArray(workflowNodes.workflowId, resultWorkflowIds)),
    ])

    // 组织数据
    const categoriesMap = new Map<string, typeof categoriesData>()
    categoriesData.forEach((item) => {
      if (!categoriesMap.has(item.workflowId)) {
        categoriesMap.set(item.workflowId, [])
      }
      categoriesMap.get(item.workflowId)!.push(item)
    })

    const nodesMap = new Map<string, string[]>()
    nodesData.forEach((item) => {
      if (!nodesMap.has(item.workflowId)) {
        nodesMap.set(item.workflowId, [])
      }
      nodesMap.get(item.workflowId)!.push(item.nodeType)
    })

    return result.map((workflow) => {
      const localized = getLocalizedWorkflow(
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
      )
      return {
        ...workflow,
        ...localized,
        categories: categoriesMap.get(workflow.id)?.map((c) => c.category) || [],
        nodeTypes: nodesMap.get(workflow.id) || [],
      }
    })
  },

  // 获取工作流总数
  getWorkflowsCount: async (params: {
    search?: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    nodeTypes?: string[]
    certified?: boolean
    timePeriod?: '7d' | '1m' | '3m' | 'all'
  }): Promise<number> => {
    const { search, categorySlugs, priceType, complexity, nodeTypes, certified, timePeriod } = params

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
    const whereConditions = [eq(workflows.status, 'published')]

    if (search) {
      whereConditions.push(
        or(
          like(workflows.title, `%${search}%`),
          like(workflows.description, `%${search}%`),
          like(authors.name, `%${search}%`),
          like(authors.username, `%${search}%`)
        )!
      )
    }

    if (priceType) {
      whereConditions.push(eq(workflows.priceType, priceType))
    }

    if (complexity) {
      whereConditions.push(eq(workflows.complexity, complexity))
    }

    if (certified !== undefined) {
      whereConditions.push(eq(workflows.certified, certified))
    }

    if (timeFilter) {
      whereConditions.push(timeFilter)
    }

    // 如果指定了分类，需要先过滤
    let workflowIds: string[] | undefined
    if (categorySlugs && categorySlugs.length > 0) {
      const categoryList = await db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.slug, categorySlugs))
      const categoryIds = categoryList.map((c) => c.id)
      if (categoryIds.length > 0) {
        const categoryWorkflows = await db
          .selectDistinct({ workflowId: workflowCategories.workflowId })
          .from(workflowCategories)
          .where(inArray(workflowCategories.categoryId, categoryIds))
        workflowIds = categoryWorkflows.map((w) => w.workflowId)
        if (workflowIds.length === 0) {
          return 0
        }
        whereConditions.push(inArray(workflows.id, workflowIds))
      }
    }

    // 如果指定了节点类型，需要先过滤
    if (nodeTypes && nodeTypes.length > 0) {
      const nodeWorkflows = await db
        .selectDistinct({ workflowId: workflowNodes.workflowId })
        .from(workflowNodes)
        .where(inArray(workflowNodes.nodeType, nodeTypes))
      const nodeWorkflowIds = nodeWorkflows.map((w) => w.workflowId)
      if (nodeWorkflowIds.length === 0) {
        return 0
      }
      if (workflowIds) {
        workflowIds = workflowIds.filter((id) => nodeWorkflowIds.includes(id))
        if (workflowIds.length === 0) {
          return 0
        }
        whereConditions.pop() // 移除之前的 inArray
        whereConditions.push(inArray(workflows.id, workflowIds))
      } else {
        whereConditions.push(inArray(workflows.id, nodeWorkflowIds))
      }
    }

    const result = await db
      .select({ count: count() })
      .from(workflows)
      .innerJoin(authors, eq(workflows.authorId, authors.id))
      .where(and(...whereConditions))

    return result[0]?.count || 0
  },

  // 根据 ID 获取工作流详情
  getWorkflowById: async (id: string, locale: 'zh' | 'en' = 'zh'): Promise<Workflow | null> => {
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
        metaDescription: workflows.metaDescription,
        authorId: workflows.authorId,
        imageUrl: workflows.imageUrl,
        workflowUrl: workflows.workflowUrl,
        workflowJson: workflows.workflowJson,
        readme: workflows.readme,
        readmeEn: workflows.readmeEn,
        priceType: workflows.priceType,
        priceAmount: workflows.priceAmount,
        currency: workflows.currency,
        complexity: workflows.complexity,
        certified: workflows.certified,
        certifiedAt: workflows.certifiedAt,
        verificationCount: workflows.verificationCount,
        popularity: workflows.popularity,
        views: workflows.views,
        downloads: workflows.downloads,
        likes: workflows.likes,
        status: workflows.status,
        publishedAt: workflows.publishedAt,
        createdAt: workflows.createdAt,
        updatedAt: workflows.updatedAt,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
      })
      .from(workflows)
      .innerJoin(authors, eq(workflows.authorId, authors.id))
      .where(eq(workflows.id, id))
      .limit(1)

    if (result.length === 0) {
      return null
    }

    const workflow = result[0]!

    // 获取分类和节点类型
    const [categoriesData, nodesData] = await Promise.all([
      db
        .select({
          category: {
            id: categories.id,
            name: categories.name,
            nameEn: categories.nameEn,
            slug: categories.slug,
          },
        })
        .from(workflowCategories)
        .innerJoin(categories, eq(workflowCategories.categoryId, categories.id))
        .where(eq(workflowCategories.workflowId, id)),
      db
        .select({
          nodeType: workflowNodes.nodeType,
        })
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, id)),
    ])

    const localized = getLocalizedWorkflow(
      {
        title: workflow.title,
        titleEn: workflow.titleEn,
        description: workflow.description,
        descriptionEn: workflow.descriptionEn,
        summary: workflow.summary,
        readme: workflow.readme,
        readmeEn: workflow.readmeEn,
      },
      locale
    )

    return {
      ...workflow,
      title: localized.title ?? '', // 确保 title 是 string 类型
      description: localized.description,
      readme: localized.readme,
      categories: categoriesData.map((c) => c.category),
      nodeTypes: nodesData.map((n) => n.nodeType),
      priceAmount: workflow.priceAmount?.toString() || null,
    }
  },

  // 根据 slug 获取工作流详情
  getWorkflowBySlug: async (slug: string, locale: 'zh' | 'en' = 'zh'): Promise<Workflow | null> => {
    const workflow = await db.select({ id: workflows.id }).from(workflows).where(eq(workflows.slug, slug)).limit(1)

    if (workflow.length === 0) {
      return null
    }

    return workflowsDataAccess.getWorkflowById(workflow[0]!.id, locale)
  },

  // 获取相关工作流（基于分类或作者）
  getRelatedWorkflows: async (params: { workflowId: string; limit?: number; locale?: 'zh' | 'en' }) => {
    const { workflowId, limit = 6, locale = 'zh' } = params

    // 先获取当前工作流的分类
    const workflowCategoriesData = await db
      .select({ categoryId: workflowCategories.categoryId })
      .from(workflowCategories)
      .where(eq(workflowCategories.workflowId, workflowId))

    const categoryIds = workflowCategoriesData.map((wc) => wc.categoryId)

    if (categoryIds.length === 0) {
      return []
    }

    // 获取相同分类的其他工作流
    const relatedWorkflowIds = await db
      .selectDistinct({ workflowId: workflowCategories.workflowId })
      .from(workflowCategories)
      .where(
        and(inArray(workflowCategories.categoryId, categoryIds), sql`${workflowCategories.workflowId} != ${workflowId}`)
      )
      .limit(limit * 2) // 获取更多，然后随机选择

    const ids = relatedWorkflowIds.map((r) => r.workflowId).slice(0, limit)

    if (ids.length === 0) {
      return []
    }

    // 获取工作流详情
    const result = await db
      .select({
        id: workflows.id,
        referenceId: workflows.referenceId,
        slug: workflows.slug,
        title: workflows.title,
        titleEn: workflows.titleEn,
        description: workflows.description,
        descriptionEn: workflows.descriptionEn,
        imageUrl: workflows.imageUrl,
        priceType: workflows.priceType,
        complexity: workflows.complexity,
        certified: workflows.certified,
        views: workflows.views,
        downloads: workflows.downloads,
        publishedAt: workflows.publishedAt,
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
      })
      .from(workflows)
      .innerJoin(authors, eq(workflows.authorId, authors.id))
      .where(and(eq(workflows.status, 'published'), inArray(workflows.id, ids)))
      .orderBy(desc(workflows.popularity))
      .limit(limit)

    // 应用本地化
    return result.map((workflow) => ({
      ...workflow,
      ...getLocalizedWorkflow(
        {
          title: workflow.title,
          titleEn: workflow.titleEn,
          description: workflow.description,
          descriptionEn: workflow.descriptionEn,
          summary: null,
          readme: null,
          readmeEn: null,
        },
        locale
      ),
    }))
  },

  // 增加浏览次数
  incrementViews: async (workflowId: string) => {
    await db
      .update(workflows)
      .set({
        views: sql`${workflows.views} + 1`,
      })
      .where(eq(workflows.id, workflowId))
  },

  // 增加下载次数
  incrementDownloads: async (workflowId: string, userId?: string, ipAddress?: string, userAgent?: string) => {
    // 更新下载次数
    await db
      .update(workflows)
      .set({
        downloads: sql`${workflows.downloads} + 1`,
      })
      .where(eq(workflows.id, workflowId))

    // 记录下载记录
    await db.insert(workflowDownloads).values({
      workflowId,
      userId: userId || null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      downloadedAt: new Date(),
    })
  },
}
