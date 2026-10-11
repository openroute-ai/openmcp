import { and, count, desc, eq, like, or } from 'drizzle-orm'
import z from 'zod'
import { db } from "@/lib/db"
import { authors, categories, skills } from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"
import { failResult } from "@/lib/gateway/input"
import { filesFromSkillRow, runSkillSecurityScan } from '@/lib/security-scan/run-scan'
import { computeAndPersistEvalReport } from '@/lib/skills/eval-report-persist'

const SKILL_STATUSES = ['draft', 'published', 'archived', 'rejected', 'pending_review', 'scanning', 'needs_revision'] as const

export const adminSkillsRouter = createTRPCRouter({
  /**
   * 分页获取 Skills 列表（全状态）。
   */
  getSkillsPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        status: z.enum(['all', ...SKILL_STATUSES]).default('all'),
        priceType: z.enum(['all', 'free', 'paid']).default('all'),
        certified: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, status, priceType, certified } = input
        const offset = (page - 1) * limit

        const whereConditions: any[] = []

        if (search) {
          whereConditions.push(
            or(
              like(skills.title, `%${search}%`),
              like(skills.slug, `%${search}%`),
              like(skills.referenceId, `%${search}%`),
              like(skills.description, `%${search}%`),
              like(authors.name, `%${search}%`)
            )!
          )
        }

        if (status !== 'all') {
          whereConditions.push(eq(skills.status, status))
        }

        if (priceType !== 'all') {
          whereConditions.push(eq(skills.priceType, priceType))
        }

        if (certified !== undefined) {
          whereConditions.push(eq(skills.certified, certified))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

        const [totalResult] = await db
          .select({ count: count() })
          .from(skills)
          .innerJoin(authors, eq(skills.authorId, authors.id))
          .where(whereClause)

        const total = totalResult?.count || 0

        const rows = await db
          .select({
            id: skills.id,
            referenceId: skills.referenceId,
            slug: skills.slug,
            title: skills.title,
            titleEn: skills.titleEn,
            description: skills.description,
            priceType: skills.priceType,
            billingModel: skills.billingModel,
            unitPrice: skills.unitPrice,
            currency: skills.currency,
            certified: skills.certified,
            certifiedAt: skills.certifiedAt,
            securityGrade: skills.securityGrade,
            reviewStatus: skills.reviewStatus,
            sourceType: skills.sourceType,
            githubUrl: skills.githubUrl,
            views: skills.views,
            downloads: skills.downloads,
            likes: skills.likes,
            platforms: skills.platforms,
            status: skills.status,
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
          .where(whereClause)
          .orderBy(desc(skills.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: rows.map((row) => ({
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
        console.error('获取 Skills 列表失败:', error)
        return {
          success: false,
          error: '获取 Skills 列表失败',
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
   * Skills 统计。
   */
  getSkillStats: adminProcedure.query(async () => {
    try {
      const [totalResult, pendingResult, publishedResult, draftResult, archivedResult, rejectedResult, certifiedResult] =
        await Promise.all([
          db.select({ count: count() }).from(skills),
          db.select({ count: count() }).from(skills).where(eq(skills.status, 'pending_review')),
          db.select({ count: count() }).from(skills).where(eq(skills.status, 'published')),
          db.select({ count: count() }).from(skills).where(eq(skills.status, 'draft')),
          db.select({ count: count() }).from(skills).where(eq(skills.status, 'archived')),
          db.select({ count: count() }).from(skills).where(eq(skills.status, 'rejected')),
          db.select({ count: count() }).from(skills).where(eq(skills.certified, true)),
        ])

      return {
        success: true,
        data: {
          total: totalResult[0]?.count || 0,
          submitted: pendingResult[0]?.count || 0,
          published: publishedResult[0]?.count || 0,
          draft: draftResult[0]?.count || 0,
          archived: archivedResult[0]?.count || 0,
          rejected: rejectedResult[0]?.count || 0,
          certified: certifiedResult[0]?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取 Skills 统计失败:', error)
      return {
        success: false,
        error: '获取 Skills 统计失败',
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
   * Skill 详情（全状态）。
   *
   * 详情页供审核员决策使用：除了列表字段，一并返回 README、特性、安全
   * 扫描结果与平台适配信息，让「够不够格上架」在一个页面里就能判断。
   */
  getSkillById: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      try {
        const rows = await db
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
            version: skills.version,
            features: skills.features,
            tags: skills.tags,
            scenario: skills.scenario,
            readme: skills.readme,
            readmeEn: skills.readmeEn,
            imageUrl: skills.imageUrl,
            priceType: skills.priceType,
            priceAmount: skills.priceAmount,
            billingModel: skills.billingModel,
            unitPrice: skills.unitPrice,
            currency: skills.currency,
            certified: skills.certified,
            certifiedAt: skills.certifiedAt,
            certificationNote: skills.certificationNote,
            securityLevel: skills.securityLevel,
            securityGrade: skills.securityGrade,
            securityFlags: skills.securityFlags,
            securityLlmGrade: skills.securityLlmGrade,
            securityLlmAnalysis: skills.securityLlmAnalysis,
            trustTier: skills.trustTier,
            scannedAt: skills.scannedAt,
            scanRulesVersion: skills.scanRulesVersion,
            reviewStatus: skills.reviewStatus,
            reviewComment: skills.reviewComment,
            sourceType: skills.sourceType,
            githubUrl: skills.githubUrl,
            platforms: skills.platforms,
            metadata: skills.metadata,
            externalSource: skills.externalSource,
            syncedFromConsoleAt: skills.syncedFromConsoleAt,
            views: skills.views,
            downloads: skills.downloads,
            likes: skills.likes,
            status: skills.status,
            publishedAt: skills.publishedAt,
            createdAt: skills.createdAt,
            updatedAt: skills.updatedAt,
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
          .where(eq(skills.id, input.id))
          .limit(1)

        const row = rows[0]
        if (!row) {
          return { success: false as const, error: 'Skill 不存在' }
        }

        return {
          success: true as const,
          data: {
            ...row,
            priceAmount: row.priceAmount?.toString() ?? null,
            unitPrice: row.unitPrice?.toString() ?? null,
          },
        }
      } catch (error) {
        console.error('获取 Skill 详情失败:', error)
        return { success: false as const, error: '获取 Skill 详情失败' }
      }
    }),

  /**
   * 审核 Skill（通过->上架 / 驳回），按 skill-review 流程同步状态与认证。
   */
  reviewSkill: adminProcedure
    .input(
      z.object({
        id: z.string(),
        action: z.enum(['approve', 'reject']),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const [skill] = await db.select().from(skills).where(eq(skills.id, input.id)).limit(1)

        if (!skill) {
          return { success: false, error: 'Skill 不存在' }
        }

        const isApproved = input.action === 'approve'
        const now = new Date()

        const [updated] = await db
          .update(skills)
          .set({
            status: isApproved ? 'published' : 'rejected',
            reviewStatus: isApproved ? 'passed' : 'rejected',
            publishedAt: isApproved ? (skill.publishedAt ?? now) : skill.publishedAt,
            certified: isApproved ? true : skill.certified,
            certifiedAt: isApproved ? (skill.certifiedAt ?? now) : skill.certifiedAt,
            certifiedBy: isApproved ? (ctx.user?.id ?? null) : skill.certifiedBy,
            reviewComment: input.note ?? null,
            reviewedBy: ctx.user?.id ?? null,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(skills.id, input.id))
          .returning()

        if (isApproved) {
          await computeAndPersistEvalReport(input.id)
        }

        return { success: true, data: updated }
      } catch (error) {
        console.error('审核 Skill 失败:', error)
        return { success: false, error: '审核 Skill 失败' }
      }
    }),

  /**
   * 更新 Skill 状态（上架/下架/归档/驳回）。
   */
  updateSkillStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(SKILL_STATUSES),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [skill] = await db.select().from(skills).where(eq(skills.id, input.id)).limit(1)

        if (!skill) {
          return { success: false, error: 'Skill 不存在' }
        }

        const now = new Date()
        const updatedData: Record<string, unknown> = {
          status: input.status,
          updatedAt: now,
        }

        if (input.status === 'published' && !skill.publishedAt) {
          updatedData.publishedAt = now
        }

        const [updated] = await db.update(skills).set(updatedData).where(eq(skills.id, input.id)).returning()

        return { success: true, data: updated }
      } catch (error) {
        console.error('更新 Skill 状态失败:', error)
        return { success: false, error: '更新 Skill 状态失败' }
      }
    }),

  /**
   * 重跑安全扫描（规则升级后需重扫才能让新规则生效）。
   */
  rescanSkill: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const [skill] = await db.select().from(skills).where(eq(skills.id, input.id)).limit(1)
        if (!skill) return { success: false, error: 'Skill 不存在' }

        const files = await filesFromSkillRow(skill)
        if (files.length === 0) {
          return { success: false, error: 'Skill 没有任何可扫描的文件' }
        }

        const outcome = await runSkillSecurityScan({ skillId: skill.id, files })
        return { success: true, grade: outcome.grade }
      } catch (error) {
        return failResult(error, '重扫 Skill 失败')
      }
    }),

  /**
   * 认证 / 取消认证 Skill。
   */
  certifySkill: adminProcedure
    .input(
      z.object({
        id: z.string(),
        certified: z.boolean(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const [skill] = await db.select().from(skills).where(eq(skills.id, input.id)).limit(1)

        if (!skill) {
          return { success: false, error: 'Skill 不存在' }
        }

        const now = new Date()
        const [updated] = await db
          .update(skills)
          .set({
            certified: input.certified,
            certifiedAt: input.certified ? (skill.certifiedAt ?? now) : null,
            certifiedBy: input.certified ? (ctx.user?.id ?? null) : null,
            certificationNote: input.certified ? (input.note ?? null) : null,
            updatedAt: now,
          })
          .where(eq(skills.id, input.id))
          .returning()

        await computeAndPersistEvalReport(input.id)

        return { success: true, data: updated }
      } catch (error) {
        console.error('认证 Skill 失败:', error)
        return { success: false, error: '认证 Skill 失败' }
      }
    }),

  /**
   * 删除 Skill（级联删除相关评分、扫描、安装等记录）。
   */
  deleteSkill: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const [skill] = await db.select().from(skills).where(eq(skills.id, input.id)).limit(1)
        if (!skill) return { success: false, error: 'Skill 不存在' }

        await db.delete(skills).where(eq(skills.id, input.id))
        return { success: true }
      } catch (error) {
        console.error('删除 Skill 失败:', error)
        return { success: false, error: '删除 Skill 失败' }
      }
    }),
})