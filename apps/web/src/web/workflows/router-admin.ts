import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import z from 'zod'
import { db } from "@/lib/db"
import {
  authors,
  categories,
  user,
  workflowCategories,
  workflowComments,
  workflowDownloads,
  workflowFavorites,
  workflowLikes,
  workflowNodes,
  workflows,
  workflowVerifications,
  workflowViews,
} from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"

export const adminWorkflowsRouter = createTRPCRouter({
  /**
   * 分页获取工作流列表
   */
  getWorkflowsPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        status: z.enum(['all', 'draft', 'published', 'archived', 'rejected']).default('all'),
        priceType: z.enum(['all', 'free', 'paid']).default('all'),
        complexity: z.enum(['all', 'beginner', 'intermediate', 'advanced']).default('all'),
        certified: z.boolean().optional(),
        authorId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, status, priceType, complexity, certified, authorId } = input
        const offset = (page - 1) * limit

        const whereConditions = []

        if (search) {
          whereConditions.push(
            or(
              like(workflows.title, `%${search}%`),
              like(workflows.description, `%${search}%`),
              like(workflows.referenceId, `%${search}%`)
            )!
          )
        }

        if (status !== 'all') {
          whereConditions.push(eq(workflows.status, status))
        }

        if (priceType !== 'all') {
          whereConditions.push(eq(workflows.priceType, priceType))
        }

        if (complexity !== 'all') {
          whereConditions.push(eq(workflows.complexity, complexity))
        }

        if (certified !== undefined) {
          whereConditions.push(eq(workflows.certified, certified))
        }

        if (authorId) {
          whereConditions.push(eq(workflows.authorId, authorId))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

        // 获取总数
        const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(workflows).where(whereClause)

        const total = totalResult?.count || 0

        // 获取数据
        const workflowsList = await db
          .select({
            id: workflows.id,
            referenceId: workflows.referenceId,
            slug: workflows.slug,
            title: workflows.title,
            titleEn: workflows.titleEn,
            description: workflows.description,
            imageUrl: workflows.imageUrl,
            priceType: workflows.priceType,
            priceAmount: workflows.priceAmount,
            complexity: workflows.complexity,
            certified: workflows.certified,
            status: workflows.status,
            views: workflows.views,
            downloads: workflows.downloads,
            likes: workflows.likes,
            publishedAt: workflows.publishedAt,
            createdAt: workflows.createdAt,
            updatedAt: workflows.updatedAt,
            author: {
              id: authors.id,
              name: authors.name,
              username: authors.username,
              avatar: authors.avatar,
            },
          })
          .from(workflows)
          .leftJoin(authors, eq(workflows.authorId, authors.id))
          .where(whereClause)
          .orderBy(desc(workflows.createdAt))
          .limit(limit)
          .offset(offset)

        const totalPages = Math.ceil(total / limit)

        return {
          success: true,
          data: workflowsList,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        }
      } catch (error) {
        console.error('获取工作流列表失败:', error)
        return {
          success: false,
          error: '获取工作流列表失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * 根据ID获取工作流详情
   */
  getWorkflowById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const [workflow] = await db
        .select({
          workflow: workflows,
          author: {
            id: authors.id,
            name: authors.name,
            username: authors.username,
            avatar: authors.avatar,
          },
        })
        .from(workflows)
        .leftJoin(authors, eq(workflows.authorId, authors.id))
        .where(eq(workflows.id, input.id))
        .limit(1)

      if (!workflow) {
        return {
          success: false,
          error: '工作流不存在',
          data: null,
        }
      }

      // 获取分类
      const categoriesList = await db
        .select({
          id: categories.id,
          name: categories.name,
          nameEn: categories.nameEn,
          slug: categories.slug,
        })
        .from(workflowCategories)
        .innerJoin(categories, eq(workflowCategories.categoryId, categories.id))
        .where(eq(workflowCategories.workflowId, input.id))

      // 获取节点类型
      const nodesList = await db
        .select({
          nodeType: workflowNodes.nodeType,
          nodeName: workflowNodes.nodeName,
          nodeNameEn: workflowNodes.nodeNameEn,
        })
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, input.id))

      return {
        success: true,
        data: {
          ...workflow.workflow,
          author: workflow.author,
          categories: categoriesList,
          nodes: nodesList,
        },
      }
    } catch (error) {
      console.error('获取工作流详情失败:', error)
      return {
        success: false,
        error: '获取工作流详情失败',
        data: null,
      }
    }
  }),

  /**
   * 创建工作流
   */
  createWorkflow: adminProcedure
    .input(
      z.object({
        referenceId: z.string().min(1),
        slug: z.string().min(1),
        title: z.string().min(1),
        titleEn: z.string().optional(),
        description: z.string().optional(),
        descriptionEn: z.string().optional(),
        summary: z.string().optional(),
        metaDescription: z.string().optional(),
        authorId: z.string().min(1),
        imageUrl: z.string().optional(),
        workflowUrl: z.string().optional(),
        workflowJson: z.any(), // JSON对象
        readme: z.string().optional(),
        readmeEn: z.string().optional(),
        priceType: z.enum(['free', 'paid']).default('free'),
        priceAmount: z.string().optional(),
        currency: z.string().default('CNY'),
        complexity: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        status: z.enum(['draft', 'published', 'archived', 'rejected']).default('draft'),
        categoryIds: z.array(z.string()).optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { categoryIds, workflowJson, ...workflowData } = input

        // 检查referenceId和slug是否已存在
        const [existingRef] = await db
          .select()
          .from(workflows)
          .where(eq(workflows.referenceId, input.referenceId))
          .limit(1)

        if (existingRef) {
          return {
            success: false,
            error: '引用ID已存在',
            data: null,
          }
        }

        const [existingSlug] = await db.select().from(workflows).where(eq(workflows.slug, input.slug)).limit(1)

        if (existingSlug) {
          return {
            success: false,
            error: '工作流标识符已存在',
            data: null,
          }
        }

        // 检查作者是否存在
        const [author] = await db.select().from(authors).where(eq(authors.id, input.authorId)).limit(1)
        if (!author) {
          return {
            success: false,
            error: '作者不存在',
            data: null,
          }
        }

        // 使用事务创建工作流
        const result = await db.transaction(async (tx) => {
          // 创建工作流
          const [workflow] = await tx
            .insert(workflows)
            .values({
              ...workflowData,
              workflowJson: workflowJson as any,
              priceAmount: workflowData.priceAmount || null,
              publishedAt: workflowData.status === 'published' ? new Date() : null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()

          if (!workflow) {
            throw new Error('创建工作流失败')
          }

          // 处理分类关联
          if (categoryIds && categoryIds.length > 0) {
            // 验证分类是否存在
            const existingCategories = await tx.select().from(categories).where(inArray(categories.id, categoryIds))

            if (existingCategories.length !== categoryIds.length) {
              throw new Error('部分分类不存在')
            }

            // 创建分类关联
            await tx.insert(workflowCategories).values(
              categoryIds.map((categoryId) => ({
                workflowId: workflow.id,
                categoryId,
                createdAt: new Date(),
              }))
            )
          }

          // 从workflowJson中提取节点类型
          if (workflowJson && typeof workflowJson === 'object') {
            const nodes = (workflowJson as any).nodes || []
            if (nodes.length > 0) {
              const nodeTypes = nodes.map((node: any) => ({
                workflowId: workflow.id,
                nodeType: node.type || '',
                nodeName: node.name || null,
                nodeNameEn: null,
                createdAt: new Date(),
              }))

              await tx.insert(workflowNodes).values(nodeTypes)
            }
          }

          return workflow
        })

        return {
          success: true,
          data: result,
        }
      } catch (error) {
        console.error('创建工作流失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '创建工作流失败',
          data: null,
        }
      }
    }),

  /**
   * 更新工作流
   */
  updateWorkflow: adminProcedure
    .input(
      z.object({
        id: z.string(),
        referenceId: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        titleEn: z.string().optional(),
        description: z.string().optional(),
        descriptionEn: z.string().optional(),
        summary: z.string().optional(),
        metaDescription: z.string().optional(),
        authorId: z.string().optional(),
        imageUrl: z.string().optional(),
        workflowUrl: z.string().optional(),
        workflowJson: z.any().optional(),
        readme: z.string().optional(),
        readmeEn: z.string().optional(),
        priceType: z.enum(['free', 'paid']).optional(),
        priceAmount: z.string().optional(),
        currency: z.string().optional(),
        complexity: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        status: z.enum(['draft', 'published', 'archived', 'rejected']).optional(),
        categoryIds: z.array(z.string()).optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { id, categoryIds, workflowJson, ...updateData } = input

        // 如果更新referenceId，检查是否已存在
        if (updateData.referenceId) {
          const [existing] = await db
            .select()
            .from(workflows)
            .where(and(eq(workflows.referenceId, updateData.referenceId), sql`${workflows.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '引用ID已存在',
              data: null,
            }
          }
        }

        // 如果更新slug，检查是否已存在
        if (updateData.slug) {
          const [existing] = await db
            .select()
            .from(workflows)
            .where(and(eq(workflows.slug, updateData.slug), sql`${workflows.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '工作流标识符已存在',
              data: null,
            }
          }
        }

        // 使用事务更新工作流
        const result = await db.transaction(async (tx) => {
          // 更新工作流
          const workflowUpdate: any = {
            ...updateData,
            updatedAt: new Date(),
          }

          if (workflowJson) {
            workflowUpdate.workflowJson = workflowJson
          }

          if (updateData.status === 'published' && updateData.status) {
            // 检查是否之前未发布
            const [current] = await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1)
            if (current && !current.publishedAt) {
              workflowUpdate.publishedAt = new Date()
            }
          }

          const [workflow] = await tx.update(workflows).set(workflowUpdate).where(eq(workflows.id, id)).returning()

          if (!workflow) {
            throw new Error('工作流不存在')
          }

          // 处理分类关联
          if (categoryIds !== undefined) {
            // 删除现有关联
            await tx.delete(workflowCategories).where(eq(workflowCategories.workflowId, id))

            // 创建新关联
            if (categoryIds.length > 0) {
              // 验证分类是否存在
              const existingCategories = await tx.select().from(categories).where(inArray(categories.id, categoryIds))

              if (existingCategories.length !== categoryIds.length) {
                throw new Error('部分分类不存在')
              }

              await tx.insert(workflowCategories).values(
                categoryIds.map((categoryId) => ({
                  workflowId: id,
                  categoryId,
                  createdAt: new Date(),
                }))
              )
            }
          }

          // 如果更新了workflowJson，更新节点类型
          if (workflowJson && typeof workflowJson === 'object') {
            // 删除现有节点
            await tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, id))

            // 插入新节点
            const nodes = (workflowJson as any).nodes || []
            if (nodes.length > 0) {
              const nodeTypes = nodes.map((node: any) => ({
                workflowId: id,
                nodeType: node.type || '',
                nodeName: node.name || null,
                nodeNameEn: null,
                createdAt: new Date(),
              }))

              await tx.insert(workflowNodes).values(nodeTypes)
            }
          }

          return workflow
        })

        return {
          success: true,
          data: result,
        }
      } catch (error) {
        console.error('更新工作流失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '更新工作流失败',
          data: null,
        }
      }
    }),

  /**
   * 更新工作流状态（归档）
   */
  updateWorkflowStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['draft', 'published', 'archived', 'rejected']),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const updateData: any = {
          status: input.status,
          updatedAt: new Date(),
        }

        // 如果状态改为published，设置发布时间
        if (input.status === 'published') {
          const [current] = await db.select().from(workflows).where(eq(workflows.id, input.id)).limit(1)
          if (current && !current.publishedAt) {
            updateData.publishedAt = new Date()
          }
        }

        const [workflow] = await db.update(workflows).set(updateData).where(eq(workflows.id, input.id)).returning()

        if (!workflow) {
          return {
            success: false,
            error: '工作流不存在',
          }
        }

        return {
          success: true,
          data: workflow,
        }
      } catch (error) {
        console.error('更新工作流状态失败:', error)
        return {
          success: false,
          error: '更新工作流状态失败',
        }
      }
    }),

  /**
   * 认证工作流
   */
  certifyWorkflow: adminProcedure
    .input(
      z.object({
        id: z.string(),
        certified: z.boolean(),
        certificationNote: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const updateData: any = {
          certified: input.certified,
          updatedAt: new Date(),
        }

        if (input.certified) {
          updateData.certifiedAt = new Date()
          updateData.certifiedBy = ctx?.user?.id || null
          if (input.certificationNote) {
            updateData.certificationNote = input.certificationNote
          }
        } else {
          updateData.certifiedAt = null
          updateData.certifiedBy = null
          updateData.certificationNote = null
        }

        const [workflow] = await db.update(workflows).set(updateData).where(eq(workflows.id, input.id)).returning()

        if (!workflow) {
          return {
            success: false,
            error: '工作流不存在',
          }
        }

        return {
          success: true,
          data: workflow,
        }
      } catch (error) {
        console.error('认证工作流失败:', error)
        return {
          success: false,
          error: '认证工作流失败',
        }
      }
    }),

  /**
   * 获取工作流统计信息
   */
  getWorkflowStats: adminProcedure.query(async () => {
    try {
      const [totalResult, publishedResult, draftResult, archivedResult, certifiedResult] = await Promise.all([
        db.select({ count: count() }).from(workflows),
        db.select({ count: count() }).from(workflows).where(eq(workflows.status, 'published')),
        db.select({ count: count() }).from(workflows).where(eq(workflows.status, 'draft')),
        db.select({ count: count() }).from(workflows).where(eq(workflows.status, 'archived')),
        db.select({ count: count() }).from(workflows).where(eq(workflows.certified, true)),
      ])

      return {
        success: true,
        data: {
          total: totalResult[0]?.count || 0,
          published: publishedResult[0]?.count || 0,
          draft: draftResult[0]?.count || 0,
          archived: archivedResult[0]?.count || 0,
          certified: certifiedResult[0]?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取工作流统计信息失败:', error)
      return {
        success: false,
        error: '获取工作流统计信息失败',
        data: {
          total: 0,
          published: 0,
          draft: 0,
          archived: 0,
          certified: 0,
        },
      }
    }
  }),

  /**
   * 获取工作流浏览记录
   */
  getWorkflowViews: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const { workflowId, page, limit } = input
        const offset = (page - 1) * limit

        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowViews)
          .where(eq(workflowViews.workflowId, workflowId))

        const total = totalResult?.count || 0

        const views = await db
          .select({
            id: workflowViews.id,
            userId: workflowViews.userId,
            ipAddress: workflowViews.ipAddress,
            userAgent: workflowViews.userAgent,
            viewedAt: workflowViews.viewedAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          })
          .from(workflowViews)
          .leftJoin(user, eq(workflowViews.userId, user.id))
          .where(eq(workflowViews.workflowId, workflowId))
          .orderBy(desc(workflowViews.viewedAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: views,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取工作流浏览记录失败:', error)
        return {
          success: false,
          error: '获取工作流浏览记录失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * 获取工作流下载记录
   */
  getWorkflowDownloads: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const { workflowId, page, limit } = input
        const offset = (page - 1) * limit

        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowDownloads)
          .where(eq(workflowDownloads.workflowId, workflowId))

        const total = totalResult?.count || 0

        const downloads = await db
          .select({
            id: workflowDownloads.id,
            userId: workflowDownloads.userId,
            ipAddress: workflowDownloads.ipAddress,
            userAgent: workflowDownloads.userAgent,
            downloadedAt: workflowDownloads.downloadedAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          })
          .from(workflowDownloads)
          .leftJoin(user, eq(workflowDownloads.userId, user.id))
          .where(eq(workflowDownloads.workflowId, workflowId))
          .orderBy(desc(workflowDownloads.downloadedAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: downloads,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取工作流下载记录失败:', error)
        return {
          success: false,
          error: '获取工作流下载记录失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * 获取工作流点赞记录
   */
  getWorkflowLikes: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const { workflowId, page, limit } = input
        const offset = (page - 1) * limit

        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowLikes)
          .where(eq(workflowLikes.workflowId, workflowId))

        const total = totalResult?.count || 0

        const likes = await db
          .select({
            id: workflowLikes.id,
            userId: workflowLikes.userId,
            createdAt: workflowLikes.createdAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          })
          .from(workflowLikes)
          .innerJoin(user, eq(workflowLikes.userId, user.id))
          .where(eq(workflowLikes.workflowId, workflowId))
          .orderBy(desc(workflowLikes.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: likes,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取工作流点赞记录失败:', error)
        return {
          success: false,
          error: '获取工作流点赞记录失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * 获取工作流收藏记录
   */
  getWorkflowFavorites: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const { workflowId, page, limit } = input
        const offset = (page - 1) * limit

        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowFavorites)
          .where(eq(workflowFavorites.workflowId, workflowId))

        const total = totalResult?.count || 0

        const favorites = await db
          .select({
            id: workflowFavorites.id,
            userId: workflowFavorites.userId,
            createdAt: workflowFavorites.createdAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          })
          .from(workflowFavorites)
          .innerJoin(user, eq(workflowFavorites.userId, user.id))
          .where(eq(workflowFavorites.workflowId, workflowId))
          .orderBy(desc(workflowFavorites.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: favorites,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取工作流收藏记录失败:', error)
        return {
          success: false,
          error: '获取工作流收藏记录失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * 获取工作流评论记录
   */
  getWorkflowComments: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
        status: z.enum(['all', 'published', 'hidden', 'deleted']).default('all'),
      })
    )
    .query(async ({ input }) => {
      try {
        const { workflowId, page, limit, status } = input
        const offset = (page - 1) * limit

        const whereConditions = [eq(workflowComments.workflowId, workflowId)]
        if (status !== 'all') {
          whereConditions.push(eq(workflowComments.status, status))
        }

        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowComments)
          .where(and(...whereConditions))

        const total = totalResult?.count || 0

        const comments = await db
          .select({
            id: workflowComments.id,
            userId: workflowComments.userId,
            parentId: workflowComments.parentId,
            content: workflowComments.content,
            status: workflowComments.status,
            createdAt: workflowComments.createdAt,
            updatedAt: workflowComments.updatedAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          })
          .from(workflowComments)
          .innerJoin(user, eq(workflowComments.userId, user.id))
          .where(and(...whereConditions))
          .orderBy(desc(workflowComments.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: comments,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取工作流评论记录失败:', error)
        return {
          success: false,
          error: '获取工作流评论记录失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * 获取工作流验证记录
   */
  getWorkflowVerifications: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
        verificationType: z.enum(['all', 'successful', 'failed', 'partial']).default('all'),
      })
    )
    .query(async ({ input }) => {
      try {
        const { workflowId, page, limit, verificationType } = input
        const offset = (page - 1) * limit

        const whereConditions = [eq(workflowVerifications.workflowId, workflowId)]
        if (verificationType !== 'all') {
          whereConditions.push(eq(workflowVerifications.verificationType, verificationType))
        }

        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowVerifications)
          .where(and(...whereConditions))

        const total = totalResult?.count || 0

        const verifications = await db
          .select({
            id: workflowVerifications.id,
            userId: workflowVerifications.userId,
            verificationType: workflowVerifications.verificationType,
            verificationNote: workflowVerifications.verificationNote,
            verifiedAt: workflowVerifications.verifiedAt,
            metadata: workflowVerifications.metadata,
            createdAt: workflowVerifications.createdAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          })
          .from(workflowVerifications)
          .innerJoin(user, eq(workflowVerifications.userId, user.id))
          .where(and(...whereConditions))
          .orderBy(desc(workflowVerifications.verifiedAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: verifications,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取工作流验证记录失败:', error)
        return {
          success: false,
          error: '获取工作流验证记录失败',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),
})
