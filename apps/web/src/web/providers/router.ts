import { z } from "zod"
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/routers/trpc"
import { getAuthorForUser, requireAuthorForUser } from "./author"
import { providersDataAccess } from "./index"
import { listMyEarnings, listMyPayoutRequests, requestPayout } from "./settlement"

export const providersRouter = createTRPCRouter({
  getMyProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const profile = await providersDataAccess.getMyProfile(ctx.user.id)
      return { success: true, data: profile }
    } catch (error) {
      console.error('获取入驻信息失败:', error)
      return { success: false, error: '获取入驻信息失败' }
    }
  }),

  upsertProfile: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['individual', 'company']).optional(),
        companyName: z.string().max(200).nullish(),
        contactName: z.string().max(100).nullish(),
        idNumber: z.string().max(100).nullish(),
        documentationUrl: z.string().max(500).nullish(),
        payChannelType: z.enum(['none', 'wechat', 'alipay']).optional(),
        agreedTerms: z.boolean().optional(),
        kycDocuments: z
          .object({
            idCardFront: z.string().max(500).optional(),
            idCardBack: z.string().max(500).optional(),
            businessLicense: z.string().max(500).optional(),
            legalPersonIdFront: z.string().max(500).optional(),
            legalPersonIdBack: z.string().max(500).optional(),
            authorizationFile: z.string().max(500).optional(),
            authorizerIdFront: z.string().max(500).optional(),
            authorizerIdBack: z.string().max(500).optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const profile = await providersDataAccess.upsertProfile(ctx.user.id, input)
        return { success: true, data: profile }
      } catch (error) {
        console.error('保存入驻信息失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '保存入驻信息失败' }
      }
    }),

  /** 
   * 绑定微信 / 支付宝收款账号（平台汇款用）
   * Batch E: 支持双通道、收款码上传、账号和二维码可选（至少一个）
   */
  updatePayChannel: protectedProcedure
    .input(
      z.object({
        payChannelType: z.enum(['wechat', 'alipay']),
        account: z.string().max(200).optional(),
        accountName: z.string().max(100).nullish(),
        qrUrl: z.string().max(500).nullish(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const profile = await providersDataAccess.updatePayChannel(ctx.user.id, {
          payChannelType: input.payChannelType,
          account: input.account,
          accountName: input.accountName,
          qrUrl: input.qrUrl,
          isDefault: input.isDefault,
        })
        return { success: true, data: profile }
      } catch (error) {
        console.error('绑定收款账户失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '绑定收款账户失败' }
      }
    }),

  getProfileByAuthorUsername: publicProcedure.input(z.object({ username: z.string() })).query(async ({ input }) => {
    try {
      const profile = await providersDataAccess.getProfileByAuthorUsername(input.username)
      return { success: true, data: profile }
    } catch {
      return { success: false, error: '获取提供者信息失败' }
    }
  }),

  /** Skill 销售分成明细 + 可提现汇总 */
  listMyEarnings: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId)
        return { success: true, data: { rows: [], summary: { payable: 0, paid: 0, total: 0, revenueShare: 0.7 } } }
      const data = await listMyEarnings(authorId)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取分成失败' }
    }
  }),

  listMyPayoutRequests: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId) return { success: true, data: [] }
      const data = await listMyPayoutRequests(authorId)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取提现记录失败' }
    }
  }),

  requestPayout: protectedProcedure
    .input(z.object({ amount: z.number().positive().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const data = await requestPayout({ userId: ctx.user.id, authorId, amount: input?.amount })
        return { success: true, data }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '申请提现失败' }
      }
    }),

  getInvoiceProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await providersDataAccess.getInvoiceProfile(ctx.user.id)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取发票信息失败' }
    }
  }),

  upsertInvoiceProfile: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        taxId: z.string().min(1).max(50),
        address: z.string().max(300).optional(),
        bank: z.string().max(200).optional(),
        phone: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await providersDataAccess.upsertInvoiceProfile(ctx.user.id, input)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '保存发票信息失败' }
      }
    }),

  /**
   * Batch B: 查询用户的 KYC 提交历史（用于 Dashboard 查看审核记录）
   */
  listMyKycSubmissions: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await providersDataAccess.listMyKycSubmissions(ctx.user.id)
      return { success: true, data }
    } catch (error) {
      console.error('获取 KYC 提交历史失败:', error)
      return { success: false, error: '获取提交历史失败' }
    }
  }),

  updateOrganizationContact: protectedProcedure
    .input(
      z.object({
        contactName: z.string().max(100).optional(),
        companyName: z.string().max(200).nullish(),
        documentationUrl: z.string().max(500).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await providersDataAccess.getMyProfile(ctx.user.id)
        if (!existing || existing.entityType !== 'company') {
          return { success: false, error: '仅企业主体可编辑企业资料，请先完成企业入驻' }
        }
        const data = await providersDataAccess.upsertProfile(ctx.user.id, {
          entityType: 'company',
          contactName: input.contactName,
          companyName: input.companyName,
          documentationUrl: input.documentationUrl,
        })
        return { success: true, data }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '更新企业资料失败' }
      }
    }),
})
