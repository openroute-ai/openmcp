import { and, count, eq, like, or, sql } from 'drizzle-orm'
import z from 'zod'
import { db } from "@/lib/db"
import { categories, workflowCategories } from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"

export const adminCategoriesRouter = createTRPCRouter({
  /**
   * 分页获取分类列表
   */
  getCategoriesPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, isActive } = input
        const offset = (page - 1) * limit

        const whereConditions = []

        if (search) {
          whereConditions.push(
            or(
              like(categories.name, `%${search}%`),
              like(categories.nameEn, `%${search}%`),
              like(categories.slug, `%${search}%`)
            )!
          )
        }

        if (isActive !== undefined) {
          whereConditions.push(eq(categories.isActive, isActive))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

        // 获取总数
        const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(categories).where(whereClause)

        const total = totalResult?.count || 0

        // 获取数据
        const categoriesList = await db
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
          .where(whereClause)
          .groupBy(categories.id)
          .orderBy(categories.order, categories.name)
          .limit(limit)
          .offset(offset)

        const totalPages = Math.ceil(total / limit)

        return {
          success: true,
          data: categoriesList.map((c) => ({
            ...c,
            workflowCount: Number(c.workflowCount) || 0,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        }
      } catch (error) {
        console.error('获取分类列表失败:', error)
        return {
          success: false,
          error: '获取分类列表失败',
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
   * 根据ID获取分类详情
   */
  getCategoryById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const [category] = await db.select().from(categories).where(eq(categories.id, input.id)).limit(1)

      if (!category) {
        return {
          success: false,
          error: '分类不存在',
          data: null,
        }
      }

      // 获取工作流数量
      const [workflowCountResult] = await db
        .select({ count: count() })
        .from(workflowCategories)
        .where(eq(workflowCategories.categoryId, category.id))

      return {
        success: true,
        data: {
          ...category,
          workflowCount: workflowCountResult?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取分类详情失败:', error)
      return {
        success: false,
        error: '获取分类详情失败',
        data: null,
      }
    }
  }),

  /**
   * 创建分类
   */
  createCategory: adminProcedure
    .input(
      z.object({
        referenceId: z.union([z.string().min(1), z.literal('')]).optional(),
        name: z.string().min(1),
        nameEn: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().optional(),
        descriptionEn: z.string().optional(),
        icon: z.string().optional(),
        order: z.number().default(0),
        isActive: z.boolean().default(true),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // 处理 referenceId：空字符串转为 null
        const referenceId = input.referenceId && input.referenceId.trim() !== '' ? input.referenceId.trim() : null

        // 检查referenceId是否已存在（仅在提供时检查）
        if (referenceId) {
          const [existingRef] = await db
            .select()
            .from(categories)
            .where(eq(categories.referenceId, referenceId))
            .limit(1)

          if (existingRef) {
            return {
              success: false,
              error: '引用ID已存在',
              data: null,
            }
          }
        }

        const [existingName] = await db.select().from(categories).where(eq(categories.name, input.name)).limit(1)

        if (existingName) {
          return {
            success: false,
            error: '分类名称已存在',
            data: null,
          }
        }

        const [existingNameEn] = await db.select().from(categories).where(eq(categories.nameEn, input.nameEn)).limit(1)

        if (existingNameEn) {
          return {
            success: false,
            error: '英文分类名称已存在',
            data: null,
          }
        }

        const [existingSlug] = await db.select().from(categories).where(eq(categories.slug, input.slug)).limit(1)

        if (existingSlug) {
          return {
            success: false,
            error: '分类标识符已存在',
            data: null,
          }
        }

        const [category] = await db
          .insert(categories)
          .values({
            ...input,
            referenceId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()

        return {
          success: true,
          data: category,
        }
      } catch (error) {
        console.error('创建分类失败:', error)
        return {
          success: false,
          error: '创建分类失败',
          data: null,
        }
      }
    }),

  /**
   * 更新分类
   */
  updateCategory: adminProcedure
    .input(
      z.object({
        id: z.string(),
        referenceId: z.union([z.string().min(1), z.literal('')]).optional(),
        name: z.string().min(1).optional(),
        nameEn: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        description: z.string().optional(),
        descriptionEn: z.string().optional(),
        icon: z.string().optional(),
        order: z.number().optional(),
        isActive: z.boolean().optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { id, ...updateData } = input

        // 处理 referenceId：空字符串转为 null，undefined 保持不变（不更新该字段）
        let processedReferenceId: string | null | undefined = updateData.referenceId
        if (updateData.referenceId !== undefined) {
          processedReferenceId =
            updateData.referenceId && updateData.referenceId.trim() !== '' ? updateData.referenceId.trim() : null
        }

        // 如果更新referenceId，检查是否已存在
        if (processedReferenceId !== undefined && processedReferenceId !== null) {
          const [existing] = await db
            .select()
            .from(categories)
            .where(and(eq(categories.referenceId, processedReferenceId), sql`${categories.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '引用ID已存在',
              data: null,
            }
          }
        }

        // 如果更新name，检查是否已存在
        if (updateData.name) {
          const [existing] = await db
            .select()
            .from(categories)
            .where(and(eq(categories.name, updateData.name), sql`${categories.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '分类名称已存在',
              data: null,
            }
          }
        }

        // 如果更新nameEn，检查是否已存在
        if (updateData.nameEn) {
          const [existing] = await db
            .select()
            .from(categories)
            .where(and(eq(categories.nameEn, updateData.nameEn), sql`${categories.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '英文分类名称已存在',
              data: null,
            }
          }
        }

        // 如果更新slug，检查是否已存在
        if (updateData.slug) {
          const [existing] = await db
            .select()
            .from(categories)
            .where(and(eq(categories.slug, updateData.slug), sql`${categories.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '分类标识符已存在',
              data: null,
            }
          }
        }

        // 构建更新数据，处理 referenceId
        const finalUpdateData: any = { ...updateData }
        // 如果 referenceId 被提供（即使是空字符串），都要更新它
        if (updateData.referenceId !== undefined) {
          finalUpdateData.referenceId = processedReferenceId
        }

        const [category] = await db
          .update(categories)
          .set({
            ...finalUpdateData,
            updatedAt: new Date(),
          })
          .where(eq(categories.id, id))
          .returning()

        if (!category) {
          return {
            success: false,
            error: '分类不存在',
            data: null,
          }
        }

        return {
          success: true,
          data: category,
        }
      } catch (error) {
        console.error('更新分类失败:', error)
        return {
          success: false,
          error: '更新分类失败',
          data: null,
        }
      }
    }),

  /**
   * 更新分类状态（上下架）
   */
  updateCategoryStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [category] = await db
          .update(categories)
          .set({
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(categories.id, input.id))
          .returning()

        if (!category) {
          return {
            success: false,
            error: '分类不存在',
          }
        }

        return {
          success: true,
          data: category,
        }
      } catch (error) {
        console.error('更新分类状态失败:', error)
        return {
          success: false,
          error: '更新分类状态失败',
        }
      }
    }),

  /**
   * 获取分类统计信息
   */
  getCategoryStats: adminProcedure.query(async () => {
    try {
      const [totalResult, activeResult, inactiveResult] = await Promise.all([
        db.select({ count: count() }).from(categories),
        db.select({ count: count() }).from(categories).where(eq(categories.isActive, true)),
        db.select({ count: count() }).from(categories).where(eq(categories.isActive, false)),
      ])

      // 获取关联工作流总数
      const [workflowCountResult] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${workflowCategories.workflowId})` })
        .from(workflowCategories)

      return {
        success: true,
        data: {
          total: totalResult[0]?.count || 0,
          active: activeResult[0]?.count || 0,
          inactive: inactiveResult[0]?.count || 0,
          workflowCount: Number(workflowCountResult?.count) || 0,
        },
      }
    } catch (error) {
      console.error('获取分类统计信息失败:', error)
      return {
        success: false,
        error: '获取分类统计信息失败',
        data: {
          total: 0,
          active: 0,
          inactive: 0,
          workflowCount: 0,
        },
      }
    }
  }),
})
