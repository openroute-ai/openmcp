import { z } from 'zod'
import { failResult, gatewayAuthInput, listingInput } from "@/lib/gateway/input"
import { isValidAssetName } from "@/lib/gateway/names"
import { ASSET_AUTH_VALUES } from "@/lib/registry-labels"
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/routers/trpc"
import { getAuthorForUser, requireAuthorForUser, requireVerifiedProviderForPublish } from "@/web/providers/author"
import { a2aGatewayAccess } from './gateway'
import { a2aAgentsDataAccess } from './index'

const registerInput = z.object({
  name: z.string().min(1, '名称必填').max(200),
  description: z.string().max(5000).nullish(),
  descriptionEn: z.string().max(5000).nullish(),
  agentCardUrl: z.string().max(2000).nullish(),
  agentCard: z.record(z.string(), z.unknown()).nullish(),
  authType: z.enum(ASSET_AUTH_VALUES).default('none'),
  categoryId: z.string().nullish(),
  priceType: z.enum(['free', 'paid']).default('free'),
  priceAmount: z.union([z.string(), z.number()]).nullish(),
  billingModel: z.enum(['one_time', 'subscription', 'pay_per_call']).nullish(),
  unitPrice: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().max(3).optional(),
})

export const a2aAgentsRouter = createTRPCRouter({
  getAgents: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(18),
        search: z.string().optional(),
        authType: z.enum(ASSET_AUTH_VALUES).optional(),
        sort: z.enum(['date-desc', 'downloads-desc', 'views-desc']).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const list = await a2aAgentsDataAccess.getAgents(input)
        const total = await a2aAgentsDataAccess.getAgentsCount(input)
        return {
          success: true,
          data: list,
          pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
        }
      } catch (error) {
        return failResult(error, '获取 A2A 智能体列表失败')
      }
    }),

  getAgentById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const data = await a2aAgentsDataAccess.getAgentById(input.id)
      if (!data) return { success: false, error: '智能体未找到' }
      await a2aAgentsDataAccess.incrementViews(input.id)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取智能体详情失败')
    }
  }),

  getRelatedAgents: publicProcedure
    .input(z.object({ id: z.string(), limit: z.number().min(1).max(12).default(6) }))
    .query(async ({ input }) => {
      try {
        const data = await a2aAgentsDataAccess.getRelatedAgents({ id: input.id, limit: input.limit })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '获取相关智能体失败')
      }
    }),

  getMyAgents: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id).catch(() => ({ authorId: null }))
      if (!authorId) return { success: true, data: [] }
      const data = await a2aAgentsDataAccess.getMyAgents(authorId)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取我的智能体失败')
    }
  }),

  register: protectedProcedure.input(registerInput).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
        requirePayChannel: input.priceType === 'paid',
      })
      const data = await a2aAgentsDataAccess.registerAgent(authorId, input)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '注册智能体失败')
    }
  }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId) return { success: true, data: [] }
      const data = await a2aGatewayAccess.listMine(authorId)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取我的 A2A 资产失败')
    }
  }),

  getMine: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const data = await a2aGatewayAccess.getMineById(authorId, input.id)
      if (!data) return { success: false, error: '资产不存在' }
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取 A2A 资产失败')
    }
  }),

  checkName: protectedProcedure.input(z.object({ name: z.string().min(1).max(80) })).query(async ({ ctx, input }) => {
    try {
      if (!isValidAssetName(input.name)) return { success: true, taken: false, valid: false }
      const { authorId, username } = await requireAuthorForUser(ctx.user.id)
      const taken = await a2aGatewayAccess.isNameTaken(authorId, input.name, username)
      return { success: true, taken, valid: true }
    } catch (error) {
      return failResult(error, '检查名称失败')
    }
  }),

  discover: protectedProcedure
    .input(z.object({ url: z.string().url(), auth: gatewayAuthInput.optional() }))
    .mutation(async ({ input }) => {
      try {
        const data = await a2aGatewayAccess.discover(input.url, input.auth ?? { type: 'none' })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '自动发现失败')
      }
    }),

  test: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        protocol: z.enum(['0.3', '1.0']).default('1.0'),
        auth: gatewayAuthInput.optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const data = await a2aGatewayAccess.test(input.url, input.protocol, input.auth ?? { type: 'none' })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '连接测试失败')
      }
    }),

  connect: protectedProcedure
    .input(
      z
        .object({
          assetName: z.string().min(1).max(80),
          displayName: z.string().max(200).optional(),
          url: z.string().url(),
          protocol: z.enum(['0.3', '1.0']).default('1.0'),
          auth: gatewayAuthInput.optional(),
          healthCheckEnabled: z.boolean().optional(),
          logoUrl: z.string().url().optional(),
          coverUrl: z.string().url().optional(),
        })
        .merge(listingInput)
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!isValidAssetName(input.assetName)) return { success: false, error: '名称格式无效' }
        const { authorId, username } = await requireAuthorForUser(ctx.user.id)
        const data = await a2aGatewayAccess.connect({
          authorId,
          providerSlug: username,
          assetName: input.assetName,
          displayName: input.displayName,
          url: input.url,
          protocol: input.protocol,
          auth: input.auth ?? { type: 'none' },
          healthCheckEnabled: input.healthCheckEnabled,
          description: input.description,
          categoryId: input.categoryId,
          visibility: input.scope,
          priceType: input.priceType,
          priceAmount: input.priceAmount,
          billingModel: input.billingModel,
          unitPrice: input.unitPrice,
          logoUrl: input.logoUrl,
          coverUrl: input.coverUrl,
        })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '接入 A2A 失败')
      }
    }),

  publish: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      // 提交上架前确认实名；付费资产在 connect 时已写入 priceType，此处再读库校验收款
      const mine = await a2aGatewayAccess.getMineById((await requireAuthorForUser(ctx.user.id)).authorId, input.id)
      const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
        requirePayChannel: mine?.price?.type === 'paid',
      })
      const data = await a2aGatewayAccess.publish(authorId, input.id)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '提交上架失败')
    }
  }),

  toggle: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const data = await a2aGatewayAccess.toggle(authorId, input.id, input.enabled)
        return { success: true, data }
      } catch (error) {
        return failResult(error, '更新状态失败')
      }
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      await a2aGatewayAccess.remove(authorId, input.id)
      return { success: true }
    } catch (error) {
      return failResult(error, '删除失败')
    }
  }),

  retest: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const data = await a2aGatewayAccess.retest(authorId, input.id)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '重新测试失败')
    }
  }),

  invoke: protectedProcedure
    .input(z.object({ id: z.string(), message: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const data = await a2aGatewayAccess.invoke(authorId, input.id, input.message)
        return { success: true, data }
      } catch (error) {
        return failResult(error, '试调失败')
      }
    }),

  startOAuth: protectedProcedure
    .input(
      z.object({
        assetName: z.string().min(1).max(80),
        clientId: z.string(),
        clientSecret: z.string(),
        authorizationUrl: z.string().url(),
        tokenUrl: z.string().url(),
        scopes: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId, username } = await requireAuthorForUser(ctx.user.id)
        const agentName = `${username}__${input.assetName}`

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:30021'
        const redirectUri = `${baseUrl}/api/oauth/callback/a2a`

        const state = Buffer.from(JSON.stringify({ agentName, authorId })).toString('base64url')
        const scopeParam = input.scopes?.join(' ') || ''
        const authUrl = new URL(input.authorizationUrl)
        authUrl.searchParams.set('client_id', input.clientId)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('state', state)
        if (scopeParam) authUrl.searchParams.set('scope', scopeParam)

        return {
          success: true,
          data: {
            authorizationUrl: authUrl.toString(),
            state,
          },
        }
      } catch (error) {
        return failResult(error, '启动 OAuth 授权失败')
      }
    }),

  checkOAuthStatus: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const asset = await a2aGatewayAccess.getMineById(authorId, input.id)
      if (!asset) return { success: false, error: '资产不存在' }

      const metadata = (asset as any).metadata as Record<string, unknown> | null
      const oauthStatus = metadata?.oauthStatus as string | undefined
      const oauthAuthorizedAt = metadata?.oauthAuthorizedAt as string | undefined

      return {
        success: true,
        data: {
          status: oauthStatus || 'unauthorized',
          authorizedAt: oauthAuthorizedAt,
        },
      }
    } catch (error) {
      return failResult(error, '查询 OAuth 状态失败')
    }
  }),
})
