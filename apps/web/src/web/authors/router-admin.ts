import { and, count, desc, eq, like, or, sql } from 'drizzle-orm'
import z from 'zod'
import { db } from "@/lib/db"
import { authors, workflows } from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"

export const adminAuthorsRouter = createTRPCRouter({
  /**
   * 分页获取作者列表
   */
  getAuthorsPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        status: z.enum(['all', 'active', 'inactive', 'suspended']).default('all'),
        verified: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, status, verified } = input
        const offset = (page - 1) * limit

        const whereConditions = []

        if (search) {
          whereConditions.push(or(like(authors.name, `%${search}%`), like(authors.username, `%${search}%`))!)
        }

        if (status !== 'all') {
          whereConditions.push(eq(authors.status, status))
        }

        if (verified !== undefined) {
          whereConditions.push(eq(authors.verified, verified))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

        // 获取总数
        const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(authors).where(whereClause)

        const total = totalResult?.count || 0

        // 获取数据
        const authorsList = await db
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
          .leftJoin(workflows, eq(workflows.authorId, authors.id))
          .where(whereClause)
          .groupBy(authors.id)
          .orderBy(desc(authors.createdAt))
          .limit(limit)
          .offset(offset)

        const totalPages = Math.ceil(total / limit)

        return {
          success: true,
          data: authorsList.map((a) => ({
            ...a,
            workflowCount: Number(a.workflowCount) || 0,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        }
      } catch (error) {
        console.error('获取作者列表失败:', error)
        return {
          success: false,
          error: '获取作者列表失败',
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
   * 根据ID获取作者详情
   */
  getAuthorById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const [author] = await db.select().from(authors).where(eq(authors.id, input.id)).limit(1)

      if (!author) {
        return {
          success: false,
          error: '作者不存在',
          data: null,
        }
      }

      // 获取工作流数量
      const [workflowCountResult] = await db
        .select({ count: count() })
        .from(workflows)
        .where(eq(workflows.authorId, author.id))

      return {
        success: true,
        data: {
          ...author,
          workflowCount: workflowCountResult?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取作者详情失败:', error)
      return {
        success: false,
        error: '获取作者详情失败',
        data: null,
      }
    }
  }),

  /**
   * 创建作者
   */
  createAuthor: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        username: z.string().min(1),
        avatar: z.string().optional(),
        description: z.string().optional(),
        bio: z.string().optional(),
        website: z.string().optional(),
        twitter: z.string().optional(),
        linkedin: z.string().optional(),
        github: z.string().optional(),
        verified: z.boolean().default(false),
        status: z.enum(['active', 'inactive', 'suspended']).default('active'),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // 检查用户名是否已存在
        const [existing] = await db.select().from(authors).where(eq(authors.username, input.username)).limit(1)

        if (existing) {
          return {
            success: false,
            error: '用户名已存在',
            data: null,
          }
        }

        const [author] = await db
          .insert(authors)
          .values({
            ...input,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()

        return {
          success: true,
          data: author,
        }
      } catch (error) {
        console.error('创建作者失败:', error)
        return {
          success: false,
          error: '创建作者失败',
          data: null,
        }
      }
    }),

  /**
   * 更新作者
   */
  updateAuthor: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        username: z.string().min(1).optional(),
        avatar: z.string().optional(),
        description: z.string().optional(),
        bio: z.string().optional(),
        website: z.string().optional(),
        twitter: z.string().optional(),
        linkedin: z.string().optional(),
        github: z.string().optional(),
        verified: z.boolean().optional(),
        status: z.enum(['active', 'inactive', 'suspended']).optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { id, ...updateData } = input

        // 如果更新用户名，检查是否已存在
        if (updateData.username) {
          const [existing] = await db
            .select()
            .from(authors)
            .where(and(eq(authors.username, updateData.username), sql`${authors.id} != ${id}`))
            .limit(1)

          if (existing) {
            return {
              success: false,
              error: '用户名已存在',
              data: null,
            }
          }
        }

        const [author] = await db
          .update(authors)
          .set({
            ...updateData,
            updatedAt: new Date(),
          })
          .where(eq(authors.id, id))
          .returning()

        if (!author) {
          return {
            success: false,
            error: '作者不存在',
            data: null,
          }
        }

        return {
          success: true,
          data: author,
        }
      } catch (error) {
        console.error('更新作者失败:', error)
        return {
          success: false,
          error: '更新作者失败',
          data: null,
        }
      }
    }),

  /**
   * 更新作者状态（上下架）
   */
  updateAuthorStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['active', 'inactive', 'suspended']),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [author] = await db
          .update(authors)
          .set({
            status: input.status,
            updatedAt: new Date(),
          })
          .where(eq(authors.id, input.id))
          .returning()

        if (!author) {
          return {
            success: false,
            error: '作者不存在',
          }
        }

        return {
          success: true,
          data: author,
        }
      } catch (error) {
        console.error('更新作者状态失败:', error)
        return {
          success: false,
          error: '更新作者状态失败',
        }
      }
    }),

  /**
   * 获取作者统计信息
   */
  getAuthorStats: adminProcedure.query(async () => {
    try {
      const [totalResult, activeResult, verifiedResult, suspendedResult] = await Promise.all([
        db.select({ count: count() }).from(authors),
        db.select({ count: count() }).from(authors).where(eq(authors.status, 'active')),
        db.select({ count: count() }).from(authors).where(eq(authors.verified, true)),
        db.select({ count: count() }).from(authors).where(eq(authors.status, 'suspended')),
      ])

      return {
        success: true,
        data: {
          total: totalResult[0]?.count || 0,
          active: activeResult[0]?.count || 0,
          verified: verifiedResult[0]?.count || 0,
          suspended: suspendedResult[0]?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取作者统计信息失败:', error)
      return {
        success: false,
        error: '获取作者统计信息失败',
        data: {
          total: 0,
          active: 0,
          verified: 0,
          suspended: 0,
        },
      }
    }
  }),
})
