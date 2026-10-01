import { and, count, desc, eq, like, or } from "drizzle-orm"
import z from "zod"
import { db } from "@/lib/db"
import { authors, providerProfiles, providerKycSubmissions, providerStatements, user, session, organization } from "@workspace/db"
import type { OrganizationMetadata } from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"
import { adminListPayoutRequests, adminUpdatePayoutRequest } from "./settlement"
import {
  adminGetStatement,
  adminListPayableStatements,
  adminListStatements,
  confirmStatement as confirmStatementForAdmin,
  markStatementPaid,
  unbilledEarningsTotal,
} from "./statements"
import { adminListRefundableEntitlements, refundSkillEntitlement } from "./refunds"

export const adminProvidersRouter = createTRPCRouter({
  /**
   * 分页获取入驻申请列表（含待审核/已通过/已驳回等）
   */
  getApplicationsPaginated: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        verificationStatus: z.enum(['all', 'unverified', 'pending', 'verified', 'rejected']).default('all'),
        payChannelStatus: z.enum(['all', 'unconnected', 'connecting', 'ready', 'error']).default('all'),
        sortBy: z.enum(['createdAt-desc', 'createdAt-asc']).default('createdAt-desc'),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, verificationStatus, payChannelStatus, sortBy } = input
        const offset = (page - 1) * limit

        const whereConditions = []

        if (search) {
          whereConditions.push(
            or(
              like(providerProfiles.companyName, `%${search}%`),
              like(providerProfiles.contactName, `%${search}%`),
              like(authors.name, `%${search}%`),
              like(user.name, `%${search}%`),
              like(user.email, `%${search}%`)
            )!
          )
        }

        if (verificationStatus !== 'all') {
          whereConditions.push(eq(providerProfiles.verificationStatus, verificationStatus))
        }

        if (payChannelStatus !== 'all') {
          whereConditions.push(eq(providerProfiles.payChannelStatus, payChannelStatus))
        }

        const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined
        const orderBy = sortBy === 'createdAt-asc' ? providerProfiles.createdAt : desc(providerProfiles.createdAt)

        const [totalResult] = await db
          .select({ count: count() })
          .from(providerProfiles)
          .leftJoin(authors, eq(providerProfiles.authorId, authors.id))
          .leftJoin(user, eq(providerProfiles.userId, user.id))
          .where(whereClause)

        const total = totalResult?.count || 0

        const applications = await db
          .select({
            id: providerProfiles.id,
            userId: providerProfiles.userId,
            authorId: providerProfiles.authorId,
            entityType: providerProfiles.entityType,
            companyName: providerProfiles.companyName,
            contactName: providerProfiles.contactName,
            idNumber: providerProfiles.idNumber,
            documentationUrl: providerProfiles.documentationUrl,
            verificationStatus: providerProfiles.verificationStatus,
            verificationNote: providerProfiles.verificationNote,
            verifiedAt: providerProfiles.verifiedAt,
            payChannelType: providerProfiles.payChannelType,
            payChannelStatus: providerProfiles.payChannelStatus,
            payChannelNote: providerProfiles.payChannelNote,
            agreedTerms: providerProfiles.agreedTerms,
            metadata: providerProfiles.metadata,
            createdAt: providerProfiles.createdAt,
            updatedAt: providerProfiles.updatedAt,
            author: {
              id: authors.id,
              name: authors.name,
              username: authors.username,
              avatar: authors.avatar,
              verified: authors.verified,
            },
            account: {
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
            },
          })
          .from(providerProfiles)
          .leftJoin(authors, eq(providerProfiles.authorId, authors.id))
          .leftJoin(user, eq(providerProfiles.userId, user.id))
          .where(whereClause)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset)

        return {
          success: true,
          data: applications,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('获取入驻申请列表失败:', error)
        return {
          success: false,
          error: '获取入驻申请列表失败',
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
   * 入驻申请统计
   */
  getApplicationsStats: adminProcedure.query(async () => {
    try {
      const [totalResult, pendingResult, verifiedResult, rejectedResult, channelReadyResult] = await Promise.all([
        db.select({ count: count() }).from(providerProfiles),
        db.select({ count: count() }).from(providerProfiles).where(eq(providerProfiles.verificationStatus, 'pending')),
        db.select({ count: count() }).from(providerProfiles).where(eq(providerProfiles.verificationStatus, 'verified')),
        db.select({ count: count() }).from(providerProfiles).where(eq(providerProfiles.verificationStatus, 'rejected')),
        db.select({ count: count() }).from(providerProfiles).where(eq(providerProfiles.payChannelStatus, 'ready')),
      ])

      return {
        success: true,
        data: {
          total: totalResult[0]?.count || 0,
          pending: pendingResult[0]?.count || 0,
          verified: verifiedResult[0]?.count || 0,
          rejected: rejectedResult[0]?.count || 0,
          channelReady: channelReadyResult[0]?.count || 0,
        },
      }
    } catch (error) {
      console.error('获取入驻申请统计失败:', error)
      return {
        success: false,
        error: '获取入驻申请统计失败',
        data: {
          total: 0,
          pending: 0,
          verified: 0,
          rejected: 0,
          channelReady: 0,
        },
      }
    }
  }),

  /**
   * 审核入驻申请（通过/驳回）
   * Batch B: 同步更新 provider_kyc_submissions 中对应的 submission 记录
   */
  reviewApplication: adminProcedure
    .input(
      z.object({
        id: z.string(),
        action: z.enum(['verify', 'reject']),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const [application] = await db.select().from(providerProfiles).where(eq(providerProfiles.id, input.id)).limit(1)

        if (!application) {
          return {
            success: false,
            error: '入驻申请不存在',
          }
        }

        const isVerified = input.action === 'verify'

        await db.transaction(async (tx) => {
          await tx
            .update(providerProfiles)
            .set({
              verificationStatus: isVerified ? 'verified' : 'rejected',
              verificationNote: input.note ?? null,
              verifiedAt: isVerified ? new Date() : null,
              updatedAt: new Date(),
              metadata: {
                ...((application.metadata as Record<string, unknown>) ?? {}),
                reviewedAt: new Date().toISOString(),
                reviewedBy: ctx.user?.id ?? null,
                reviewAction: input.action,
              },
            })
            .where(eq(providerProfiles.id, input.id))

          if (application.authorId) {
            await tx
              .update(authors)
              .set({
                verified: isVerified,
              })
              .where(eq(authors.id, application.authorId))
          }

          // Batch B: 更新最新的 pending submission 状态
          const [latestSubmission] = await tx
            .select()
            .from(providerKycSubmissions)
            .where(
              and(
                eq(providerKycSubmissions.userId, application.userId),
                eq(providerKycSubmissions.status, 'pending')
              )
            )
            .orderBy(desc(providerKycSubmissions.createdAt))
            .limit(1)

          if (latestSubmission) {
            await tx
              .update(providerKycSubmissions)
              .set({
                status: isVerified ? 'verified' : 'rejected',
                verificationNote: input.note ?? null,
                reviewedBy: ctx.user?.id ?? null,
                reviewedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(providerKycSubmissions.id, latestSubmission.id))
          }

          // Batch C: 公司认证通过后的处理
          if (isVerified && latestSubmission && latestSubmission.entityType === 'company' && application.organizationId) {
            // 1. 检查是否存在之前的 individual verified submission(需要标记为 superseded)
            const [priorIndividualSubmission] = await tx
              .select()
              .from(providerKycSubmissions)
              .where(
                and(
                  eq(providerKycSubmissions.userId, application.userId),
                  eq(providerKycSubmissions.entityType, 'individual'),
                  eq(providerKycSubmissions.status, 'verified')
                )
              )
              .orderBy(desc(providerKycSubmissions.createdAt))
              .limit(1)

            if (priorIndividualSubmission) {
              await tx
                .update(providerKycSubmissions)
                .set({
                  status: 'superseded',
                  updatedAt: new Date(),
                })
                .where(eq(providerKycSubmissions.id, priorIndividualSubmission.id))

              await tx
                .update(providerKycSubmissions)
                .set({
                  supersedesId: priorIndividualSubmission.id,
                  updatedAt: new Date(),
                })
                .where(eq(providerKycSubmissions.id, latestSubmission.id))
            }

            // 2. 更新 organization metadata 中的 kycSummary
            const [companyOrg] = await tx
              .select({ metadata: organization.metadata })
              .from(organization)
              .where(eq(organization.id, application.organizationId))
              .limit(1)

            if (companyOrg) {
              const orgMetadata = (companyOrg.metadata as OrganizationMetadata) || {}
              await tx
                .update(organization)
                .set({
                  metadata: {
                    ...orgMetadata,
                    kycSummary: {
                      contactName: application.contactName || undefined,
                      companyName: application.companyName || undefined,
                      verifiedAt: new Date().toISOString(),
                    },
                  } as any,
                })
                .where(eq(organization.id, application.organizationId))
            }

            // 3. 切换用户的 activeOrganizationId 到公司组织
            await tx
              .update(session)
              .set({
                activeOrganizationId: application.organizationId,
              })
              .where(eq(session.userId, application.userId))
          }
        })

        return {
          success: true,
          data: {
            id: application.id,
            verificationStatus: isVerified ? 'verified' : 'rejected',
          },
        }
      } catch (error) {
        console.error('审核入驻申请失败:', error)
        return {
          success: false,
          error: '审核入驻申请失败',
        }
      }
    }),

  /**
   * 更新收款通道状态
   */
  listPayoutRequests: adminProcedure
    .input(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'paid']).optional() }).optional())
    .query(async ({ input }) => {
      try {
        const data = await adminListPayoutRequests(input?.status)
        return { success: true, data }
      } catch (error) {
        console.error('listPayoutRequests', error)
        return { success: false, error: '获取提现申请失败', data: [] }
      }
    }),

  updatePayoutRequest: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['approved', 'rejected', 'paid']),
        adminNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const data = await adminUpdatePayoutRequest(input)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '更新提现申请失败' }
      }
    }),

  /**
   * 月度账单列表。
   *
   * 与 `listPayoutRequests` 并存而非替换：老的提现申请是"创作者随时提",
   * 账单是"按月结"，两者的状态机不同（账单不允许创作者挑金额），迁移期
   * 两个入口都要能查到历史记录。
   */
  listStatements: adminProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'confirmed', 'paid', 'rolled']).optional(),
        period: z
          .string()
          .regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM')
          .optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      try {
        const data = await adminListStatements(input)
        return { success: true, data }
      } catch (error) {
        console.error('listStatements', error)
        return { success: false, error: '获取账单列表失败', data: [] }
      }
    }),

  /** 打款清单：已确认待打款，按打款日排序，带是否到期。 */
  listPayableStatements: adminProcedure.query(async () => {
    try {
      const data = await adminListPayableStatements()
      return { success: true, data }
    } catch (error) {
      console.error('listPayableStatements', error)
      return { success: false, error: '获取打款清单失败', data: [] }
    }
  }),

  /** 账单明细：核对这张账单聚合了哪些收入行。 */
  getStatementDetail: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      try {
        const data = await adminGetStatement(input.id)
        if (!data) return { success: false, error: '账单不存在', data: null }
        return { success: true, data }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取账单明细失败',
          data: null,
        }
      }
    }),

  /**
   * 财务代确认（创作者逾期未确认时的兜底）。
   *
   * 保留这条而不是只靠自动确认：自动确认在 19 日跑，若当天 cron 挂了，
   * 20 日的打款会被"账单尚未确认"挡住，而这里是财务能立刻解开的那一步。
   */
  confirmStatement: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select({ authorId: providerStatements.authorId })
        .from(providerStatements)
        .where(eq(providerStatements.id, input.id))
        .limit(1)
      if (!row) return { success: false, error: '账单不存在' }

      const result = await confirmStatementForAdmin({
        authorId: row.authorId,
        statementId: input.id,
        userId: ctx.user.id,
        onBehalf: true,
      })
      return result.ok
        ? { success: true, data: result.statement }
        : { success: false, error: result.error }
    }),

  /**
   * 登记打款（线下转账已完成后回填凭证号）。
   *
   * 幂等：重复提交返回 `alreadyPaid: true`，不会把 `paidAt` 刷新或二次置
   * 收入行 `paid`。
   */
  markStatementPaid: adminProcedure
    .input(
      z.object({
        id: z.string(),
        payoutReference: z.string().min(1).max(200),
        adminNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await markStatementPaid({
        statementId: input.id,
        adminUserId: ctx.user.id,
        payoutReference: input.payoutReference,
        adminNote: input.adminNote,
      })
      return result.ok
        ? { success: true, data: result.statement, alreadyPaid: result.alreadyPaid }
        : { success: false, error: result.error }
    }),

  /** 未出账收入总额，用于后台提示"还有多少没进账单"。 */
  unbilledEarnings: adminProcedure.query(async () => {
    try {
      return { success: true, data: await unbilledEarningsTotal() }
    } catch (error) {
      console.error('unbilledEarnings', error)
      return { success: false, error: '获取待出账金额失败', data: { count: 0, net: 0 } }
    }
  }),

  /**
   * 退款：撤销买家权益 + 退回平台余额 + 冲回创作者分成。
   *
   * 幂等由 `skill_entitlements.status` 承担——重复调用返回"已退款"，不会
   * 二次退钱。`reason` 必填：创作者在账单里看到的负数行只有这一句解释。
   */
  /**
   * 可退款权益列表。退款接口需要一个能列出 `skill_entitlements` 的入口，
   * 否则运营只能靠猜 id 去调退款。
   */
  listRefundableEntitlements: adminProcedure
    .input(
      z
        .object({
          status: z.enum(['active', 'revoked', 'all']).optional(),
          search: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        return { success: true as const, data: await adminListRefundableEntitlements(input ?? {}) }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : '获取可退款权益失败',
          data: null,
        }
      }
    }),

  refundEntitlement: adminProcedure
    .input(
      z.object({
        entitlementId: z.string(),
        reason: z.string().min(1).max(500),
        amount: z.number().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await refundSkillEntitlement({
          entitlementId: input.entitlementId,
          adminUserId: ctx.user.id,
          reason: input.reason,
          amount: input.amount,
        })
        return data.ok ? { success: true, data } : { success: false, error: data.error }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '退款失败' }
      }
    }),

  updatePayChannelStatus: adminProcedure
    .input(
      z.object({
        id: z.string(),
        payChannelStatus: z.enum(['unconnected', 'connecting', 'ready', 'error']),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const [application] = await db
          .update(providerProfiles)
          .set({
            payChannelStatus: input.payChannelStatus,
            payChannelNote: input.note ?? null,
            updatedAt: new Date(),
          })
          .where(eq(providerProfiles.id, input.id))
          .returning()

        if (!application) {
          return {
            success: false,
            error: '入驻申请不存在',
          }
        }

        return {
          success: true,
          data: application,
        }
      } catch (error) {
        console.error('更新收款通道状态失败:', error)
        return {
          success: false,
          error: '更新收款通道状态失败',
        }
      }
    }),
})
