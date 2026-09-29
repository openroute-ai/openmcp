import { and, count, desc, eq, like, or } from "drizzle-orm"
import z from "zod"
import { db } from "@/lib/db"
import { authors, providerProfiles, providerKycSubmissions, user, session, organization } from "@workspace/db"
import type { OrganizationMetadata } from "@workspace/db"
import { adminProcedure, createTRPCRouter } from "@/server/routers/trpc"
import { adminListPayoutRequests, adminUpdatePayoutRequest } from "./settlement"

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
