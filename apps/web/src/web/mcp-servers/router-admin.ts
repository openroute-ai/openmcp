import { and, count, desc, eq, like, or } from 'drizzle-orm'
import z from 'zod'
import { db } from "@/lib/db"
import { authors, categories, mcpServers } from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"

export const adminMcpServersRouter = createTRPCRouter({
  /**
   * 分页获取 MCP Server 列表（全状态，含待审核）
   */
  getServersPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        status: z.enum(['all', 'draft', 'submitted', 'published', 'archived', 'rejected']).default('all'),
        transport: z.enum(['all', 'http', 'sse', 'stdio']).default('all'),
        priceType: z.enum(['all', 'free', 'paid']).default('all'),
        certified: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, status, transport, priceType, certified } = input
        const offset = (page - 1) * limit

        const whereConditions = []

        if (search) {
          whereConditions.push(
            or(
              like(mcpServers.name, `%${search}%`),
              like(mcpServers.description, `%${search}%`),
              like(mcpServers.endpoint, `%${search}%`),
              like(mcpServers.referenceId, `%${search}%`),
              like(authors.name, `%${search}%`)
            )!
          )
        }

        if (status !== 'all') {
          whereConditions.push(eq(mcpServers.status, status))
        }

        if (transport !== 'all') {
          whereConditions.push(eq(mcpServers.transport, transport))
        }

        if (priceType !== 'all') {
          whereConditions.push(eq(mcpServers.priceType, priceType))
        }

        if (certified !== undefined) {
          whereConditions.push(eq(mcpServers.certified, certified))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

        const [totalResult] = await db
          .select({ count: count() })
          .from(mcpServers)
          .innerJoin(authors, eq(mcpServers.authorId, authors.id))
          .where(whereClause)

        const total = totalResult?.count || 0

        const servers = await db
          .select({
            id: mcpServers.id,
            referenceId: mcpServers.referenceId,
            slug: mcpServers.slug,
            name: mcpServers.name,
            description: mcpServers.description,
            logoUrl: mcpServers.logoUrl,
            transport: mcpServers.transport,
            endpoint: mcpServers.endpoint,
            hosting: mcpServers.hosting,
            scope: mcpServers.scope,
            priceType: mcpServers.priceType,
            billingModel: mcpServers.billingModel,
            unitPrice: mcpServers.unitPrice,
            currency: mcpServers.currency,
            certified: mcpServers.certified,
            securityLevel: mcpServers.securityLevel,
            views: mcpServers.views,
            downloads: mcpServers.downloads,
            status: mcpServers.status,
            publishedAt: mcpServers.publishedAt,
            createdAt: mcpServers.createdAt,
            metadata: mcpServers.metadata,
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
          .from(mcpServers)
          .innerJoin(authors, eq(mcpServers.authorId, authors.id))
          .leftJoin(categories, eq(mcpServers.categoryId, categories.id))
          .where(whereClause)
          .orderBy(desc(mcpServers.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: servers.map((row) => ({
            ...row,
            unitPrice: row.unitPrice?.toString() ?? null,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取 MCP Server 列表失败:', error)
        return {
          success: false,
          error: '获取 MCP Server 列表失败',
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
   * MCP Server 统计
   */
  getServerStats: adminProcedure.query(async () => {
    try {
      const [
        totalResult,
        submittedResult,
        publishedResult,
        draftResult,
        archivedResult,
        rejectedResult,
        certifiedResult,
      ] = await Promise.all([
        db.select({ count: count() }).from(mcpServers),
        db.select({ count: count() }).from(mcpServers).where(eq(mcpServers.status, 'submitted')),
        db.select({ count: count() }).from(mcpServers).where(eq(mcpServers.status, 'published')),
        db.select({ count: count() }).from(mcpServers).where(eq(mcpServers.status, 'draft')),
        db.select({ count: count() }).from(mcpServers).where(eq(mcpServers.status, 'archived')),
        db.select({ count: count() }).from(mcpServers).where(eq(mcpServers.status, 'rejected')),
        db.select({ count: count() }).from(mcpServers).where(eq(mcpServers.certified, true)),
      ])

      return {
        success: true,
        data: {
          total: totalResult[0]?.count || 0,
          submitted: submittedResult[0]?.count || 0,
          published: publishedResult[0]?.count || 0,
          draft: draftResult[0]?.count || 0,
          archived: archivedResult[0]?.count || 0,
          rejected: rejectedResult[0]?.count || 0,
          certified: certifiedResult[0]?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取 MCP Server 统计失败:', error)
      return {
        success: false,
        error: '获取 MCP Server 统计失败',
        data: {
          total: 0,
          submitted: 0,
          published: 0,
          draft: 0,
          archived: 0,
          rejected: 0,
          certified: 0,
        },
      }
    }
  }),

  /**
   * 审核 MCP Server（通过->上架 / 驳回）
   */
  reviewServer: adminProcedure
    .input(
      z.object({
        id: z.string(),
        action: z.enum(['approve', 'reject']),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, input.id)).limit(1)

        if (!server) {
          return {
            success: false,
            error: 'MCP Server 不存在',
          }
        }

        const isApproved = input.action === 'approve'
        const metadata = {
          ...((server.metadata as Record<string, unknown>) ?? {}),
          reviewNote: input.note ?? null,
          reviewedAt: new Date().toISOString(),
          reviewedBy: ctx.user?.id ?? null,
        }

        const [updated] = await db
          .update(mcpServers)
          .set({
            status: isApproved ? 'published' : 'rejected',
            publishedAt: isApproved && !server.publishedAt ? new Date() : server.publishedAt,
            metadata,
            updatedAt: new Date(),
          })
          .where(eq(mcpServers.id, input.id))
          .returning()

        return {
          success: true,
          data: updated,
        }
      } catch (error) {
        console.error('审核 MCP Server 失败:', error)
        return {
          success: false,
          error: '审核 MCP Server 失败',
        }
      }
    }),

  /**
   * 更新 MCP Server 状态（上架/下架/归档）
   */
  updateServerStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['draft', 'submitted', 'published', 'archived', 'rejected']),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, input.id)).limit(1)

        if (!server) {
          return {
            success: false,
            error: 'MCP Server 不存在',
          }
        }

        const updatedData: Record<string, unknown> = {
          status: input.status,
          updatedAt: new Date(),
        }

        if (input.status === 'published' && !server.publishedAt) {
          updatedData.publishedAt = new Date()
        }

        const [updated] = await db.update(mcpServers).set(updatedData).where(eq(mcpServers.id, input.id)).returning()

        return {
          success: true,
          data: updated,
        }
      } catch (error) {
        console.error('更新 MCP Server 状态失败:', error)
        return {
          success: false,
          error: '更新 MCP Server 状态失败',
        }
      }
    }),

  /**
   * 认证 MCP Server
   */
  certifyServer: adminProcedure
    .input(
      z.object({
        id: z.string(),
        certified: z.boolean(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, input.id)).limit(1)

        if (!server) {
          return {
            success: false,
            error: 'MCP Server 不存在',
          }
        }

        const metadata = {
          ...((server.metadata as Record<string, unknown>) ?? {}),
          certificationNote: input.certified ? (input.note ?? null) : null,
        }

        const [updated] = await db
          .update(mcpServers)
          .set({
            certified: input.certified,
            metadata,
            updatedAt: new Date(),
          })
          .where(eq(mcpServers.id, input.id))
          .returning()

        return {
          success: true,
          data: updated,
        }
      } catch (error) {
        console.error('认证 MCP Server 失败:', error)
        return {
          success: false,
          error: '认证 MCP Server 失败',
        }
      }
    }),
})
