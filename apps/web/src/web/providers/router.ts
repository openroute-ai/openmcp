import { count, eq } from "drizzle-orm"
import { z } from "zod"
import { providerPayoutRequests } from "@workspace/db"
import { db } from "@/lib/db"
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/routers/trpc"
import { getAuthorForUser, requireAuthorForUser } from "./author"
import { providersDataAccess } from "./index"
import { listMyEarnings, listMyPayoutRequests, paginatedInput, requestPayout } from "./settlement"
import { confirmStatement, getMyStatement, listMyStatements, settlementPeriodFor, statementTimeline } from "./statements"

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
        /** 联系方式（手机号），存 metadata */
        contactPhone: z.string().max(30).nullish(),
        /** true 才校验完整性并进入待审核；缺省只保存草稿 */
        submitForReview: z.boolean().optional(),
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
  listMyEarnings: protectedProcedure.input(paginatedInput).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId)
        return { success: true, data: { rows: [], summary: { payable: 0, paid: 0, total: 0, revenueShare: 0.7 }, total: 0, page: 1, pageSize: 20 } }
      const data = await listMyEarnings(authorId, { page: input.page, pageSize: input.pageSize })
      return { success: true, data }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取分成失败' }
    }
  }),

  /**
   * 我的月度账单。
   *
   * 结算改按月后这是创作者的主入口，`listMyEarnings` 退化为"账单生成前的
   * 实时明细"，两者并存因为前者是账单快照、后者会随退款clawback 变动。
   */
  listMyStatements: protectedProcedure.input(paginatedInput).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      // 与 `listMyEarnings` 一样返回空壳而非空数组：页面读`data.rows` 和
      // `data.summary`，返回 `[]` 会让汇总消失而不是显示为 0。
      if (!authorId)
        return {
          success: true,
          data: {
            rows: [],
            summary: { pending: 0, confirmed: 0, paid: 0, rolled: 0, netTotal: 0 },
            total: 0,
            page: 1,
            pageSize: 24,
          },
        }
      return {
        success: true,
        data: await listMyStatements(authorId, { page: input.page, pageSize: input.pageSize }),
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取账单失败' }
    }
  }),

  /**
   * 某期时间线（次月 5 日出账 / 19 日确认截止 / 20 日打款）。
   *
   * 缺省返回**上一期**——创作者打开页面时关心的永远是"上一期账单什么时候
   * 截止"，而不是需要自己去算 `YYYY-MM` 的某个历史月份。
   */
  getStatementTimeline: protectedProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const { authorId } = await getAuthorForUser(ctx.user.id)
        if (!authorId) return { success: true, data: null }
        return { success: true, data: statementTimeline(input?.period ?? settlementPeriodFor(new Date())) }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '获取结算时间线失败' }
      }
    }),

  /**
   * 单张账单详情：账单本体 + 时间线 + 收益构成 + 分页逐笔明细。
   *
   * 归属校验在 `getMyStatement` 的 SQL 里完成，别人的账单返回「账单不存在」。
   */
  getMyStatementDetail: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { authorId } = await getAuthorForUser(ctx.user.id)
        if (!authorId) return { success: false, error: '账单不存在', data: null }
        const data = await getMyStatement(authorId, input.id, {
          page: input.page,
          pageSize: input.pageSize,
        })
        if (!data) return { success: false, error: '账单不存在', data: null }
        return { success: true, data }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取账单详情失败',
          data: null,
        }
      }
    }),

  /**
   * 创作者确认账单。
   *
   * 过了 19 日会被自动确认，所以"当前可确认"要查出来给页面禁用按钮——
   * 否则用户点了只会拿到一句"未到确认时间"，像是坏了。
   */
  confirmStatement: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const result = await confirmStatement({
          authorId,
          statementId: input.id,
          userId: ctx.user.id,
        })
        return result.ok ? { success: true, data: result.statement } : { success: false, error: result.error }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '确认账单失败' }
      }
    }),

  listMyPayoutRequests: protectedProcedure.input(paginatedInput).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId) return { success: true, data: [], total: 0 }
      const data = await listMyPayoutRequests(authorId, {
        page: input.page,
        pageSize: input.pageSize,
      })
      const [totalRow] = await db
        .select({ n: count() })
        .from(providerPayoutRequests)
        .where(eq(providerPayoutRequests.authorId, authorId))
      return { success: true, data, total: totalRow?.n ?? 0 }
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
