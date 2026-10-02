import { and, count, desc, eq, like, or } from 'drizzle-orm'
import z from 'zod'
import { db } from "@/lib/db"
import { a2aAgents, authors, categories } from "@workspace/db"
import { ASSET_AUTH_VALUES } from "@/lib/registry-labels"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"
import { failResult } from "@/lib/gateway/input"
import { persistA2aScan } from "@/web/assets/scan-persist"
import { notDeleted } from "@/web/assets/visibility"

/**
 * Agent Card 的能力列表。字段名随协议版本变化（0.3 / 1.0 不同），
 * 取不到就返回空数组——扫不到声明不等于声明干净。
 */
function readAgentCardSkills(card: unknown): Array<{ name: string; description?: string }> {
  if (!card || typeof card !== 'object') return []
  const raw = (card as { skills?: unknown }).skills
  if (!Array.isArray(raw)) return []
  const out: Array<{ name: string; description?: string }> = []
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push({ name: item })
      continue
    }
    if (item && typeof item === 'object') {
      const o = item as { name?: unknown; id?: unknown; description?: unknown }
      const name = typeof o.name === 'string' ? o.name : typeof o.id === 'string' ? o.id : null
      if (!name) continue
      out.push({ name, description: typeof o.description === 'string' ? o.description : undefined })
    }
  }
  return out
}

export const adminA2aAgentsRouter = createTRPCRouter({
  /**
   * 分页获取 A2A 智能体列表（全状态，含待审核）
   */
  getAgentsPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        status: z.enum(['all', 'draft', 'submitted', 'published', 'archived', 'rejected']).default('all'),
        authType: z.enum(['all', ...ASSET_AUTH_VALUES]).default('all'),
        priceType: z.enum(['all', 'free', 'paid']).default('all'),
        certified: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, status, authType, priceType, certified } = input
        const offset = (page - 1) * limit

        // 软删除的行不再进入后台列表：平台上已经没有这个资产，审核员
        // 也不该对它做审核动作。
        const whereConditions = [notDeleted(a2aAgents)]

        if (search) {
          whereConditions.push(
            or(
              like(a2aAgents.name, `%${search}%`),
              like(a2aAgents.description, `%${search}%`),
              like(a2aAgents.referenceId, `%${search}%`),
              like(authors.name, `%${search}%`)
            )!
          )
        }

        if (status !== 'all') {
          whereConditions.push(eq(a2aAgents.status, status))
        }

        if (authType !== 'all') {
          whereConditions.push(eq(a2aAgents.authType, authType))
        }

        if (priceType !== 'all') {
          whereConditions.push(eq(a2aAgents.priceType, priceType))
        }

        if (certified !== undefined) {
          whereConditions.push(eq(a2aAgents.certified, certified))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

        const [totalResult] = await db
          .select({ count: count() })
          .from(a2aAgents)
          .innerJoin(authors, eq(a2aAgents.authorId, authors.id))
          .where(whereClause)

        const total = totalResult?.count || 0

        const agents = await db
          .select({
            id: a2aAgents.id,
            referenceId: a2aAgents.referenceId,
            slug: a2aAgents.slug,
            name: a2aAgents.name,
            description: a2aAgents.description,
            logoUrl: a2aAgents.logoUrl,
            agentCardUrl: a2aAgents.agentCardUrl,
            authType: a2aAgents.authType,
            priceType: a2aAgents.priceType,
            billingModel: a2aAgents.billingModel,
            unitPrice: a2aAgents.unitPrice,
            currency: a2aAgents.currency,
            certified: a2aAgents.certified,
            securityLevel: a2aAgents.securityLevel,
            views: a2aAgents.views,
            downloads: a2aAgents.downloads,
            status: a2aAgents.status,
            publishedAt: a2aAgents.publishedAt,
            createdAt: a2aAgents.createdAt,
            metadata: a2aAgents.metadata,
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
          .from(a2aAgents)
          .innerJoin(authors, eq(a2aAgents.authorId, authors.id))
          .leftJoin(categories, eq(a2aAgents.categoryId, categories.id))
          .where(whereClause)
          .orderBy(desc(a2aAgents.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: agents.map((row) => ({
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
        console.error('获取 A2A 智能体列表失败:', error)
        return {
          success: false,
          error: '获取 A2A 智能体列表失败',
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
   * A2A 智能体统计
   */
  getAgentStats: adminProcedure.query(async () => {
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
        db.select({ count: count() }).from(a2aAgents).where(notDeleted(a2aAgents)),
        db.select({ count: count() }).from(a2aAgents).where(and(notDeleted(a2aAgents), eq(a2aAgents.status, 'submitted'))),
        db.select({ count: count() }).from(a2aAgents).where(and(notDeleted(a2aAgents), eq(a2aAgents.status, 'published'))),
        db.select({ count: count() }).from(a2aAgents).where(and(notDeleted(a2aAgents), eq(a2aAgents.status, 'draft'))),
        db.select({ count: count() }).from(a2aAgents).where(and(notDeleted(a2aAgents), eq(a2aAgents.status, 'archived'))),
        db.select({ count: count() }).from(a2aAgents).where(and(notDeleted(a2aAgents), eq(a2aAgents.status, 'rejected'))),
        db.select({ count: count() }).from(a2aAgents).where(and(notDeleted(a2aAgents), eq(a2aAgents.certified, true))),
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
      console.error('获取 A2A 智能体统计失败:', error)
      return {
        success: false,
        error: '获取 A2A 智能体统计失败',
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
   * 审核 A2A 智能体（通过->上架 / 驳回）
   */
  reviewAgent: adminProcedure
    .input(
      z.object({
        id: z.string(),
        action: z.enum(['approve', 'reject']),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const [agent] = await db.select().from(a2aAgents).where(and(eq(a2aAgents.id, input.id), notDeleted(a2aAgents))).limit(1)

        if (!agent) {
          return {
            success: false,
            error: 'A2A 智能体不存在',
          }
        }

        const isApproved = input.action === 'approve'
        const metadata = {
          ...((agent.metadata as Record<string, unknown>) ?? {}),
          reviewNote: input.note ?? null,
          reviewedAt: new Date().toISOString(),
          reviewedBy: ctx.user?.id ?? null,
        }

        const [updated] = await db
          .update(a2aAgents)
          .set({
            status: isApproved ? 'published' : 'rejected',
            publishedAt: isApproved && !agent.publishedAt ? new Date() : agent.publishedAt,
            metadata,
            updatedAt: new Date(),
          })
          .where(eq(a2aAgents.id, input.id))
          .returning()

        return {
          success: true,
          data: updated,
        }
      } catch (error) {
        console.error('审核 A2A 智能体失败:', error)
        return {
          success: false,
          error: '审核 A2A 智能体失败',
        }
      }
    }),

  /**
   * 更新 A2A 智能体状态（上架/下架/归档）
   */
  updateAgentStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['draft', 'submitted', 'published', 'archived', 'rejected']),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [agent] = await db.select().from(a2aAgents).where(and(eq(a2aAgents.id, input.id), notDeleted(a2aAgents))).limit(1)

        if (!agent) {
          return {
            success: false,
            error: 'A2A 智能体不存在',
          }
        }

        const updatedData: Record<string, unknown> = {
          status: input.status,
          updatedAt: new Date(),
        }

        if (input.status === 'published' && !agent.publishedAt) {
          updatedData.publishedAt = new Date()
        }

        const [updated] = await db.update(a2aAgents).set(updatedData).where(eq(a2aAgents.id, input.id)).returning()

        return {
          success: true,
          data: updated,
        }
      } catch (error) {
        console.error('更新 A2A 智能体状态失败:', error)
        return {
          success: false,
          error: '更新 A2A 智能体状态失败',
        }
      }
    }),

  /** 重跑元数据扫描，理由同 MCP 的 `rescanServer`。 */
  rescanAgent: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const [agent] = await db
          .select()
          .from(a2aAgents)
          .where(and(eq(a2aAgents.id, input.id), notDeleted(a2aAgents)))
          .limit(1)
        if (!agent) return { success: false, error: 'A2A 智能体不存在' }

        const outcome = await persistA2aScan(agent.id, {
          kind: 'a2a',
          endpoint: agent.endpoint,
          protocol: agent.protocolVersion,
          auth: agent.authType,
          name: agent.name,
          description: agent.description ?? agent.descriptionEn,
          tools: readAgentCardSkills(agent.agentCard),
        })
        return { success: true, grade: outcome.grade }
      } catch (error) {
        return failResult(error, '重扫 A2A 智能体失败')
      }
    }),

  /**
   * 认证 A2A 智能体
   */
  certifyAgent: adminProcedure
    .input(
      z.object({
        id: z.string(),
        certified: z.boolean(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [agent] = await db.select().from(a2aAgents).where(and(eq(a2aAgents.id, input.id), notDeleted(a2aAgents))).limit(1)

        if (!agent) {
          return {
            success: false,
            error: 'A2A 智能体不存在',
          }
        }

        const metadata = {
          ...((agent.metadata as Record<string, unknown>) ?? {}),
          certificationNote: input.certified ? (input.note ?? null) : null,
        }

        const [updated] = await db
          .update(a2aAgents)
          .set({
            certified: input.certified,
            metadata,
            updatedAt: new Date(),
          })
          .where(eq(a2aAgents.id, input.id))
          .returning()

        return {
          success: true,
          data: updated,
        }
      } catch (error) {
        console.error('认证 A2A 智能体失败:', error)
        return {
          success: false,
          error: '认证 A2A 智能体失败',
        }
      }
    }),
})
