import { z } from 'zod'
import { failResult, gatewayAuthInput, listingInput } from "@/lib/gateway/input"
import { isValidAssetName } from "@/lib/gateway/names"
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/routers/trpc"
import { getAuthorForUser, requireAuthorForUser, requireVerifiedProviderForPublish } from "@/web/providers/author"
import { signOAuthState } from "@/lib/agent-install/oauth-state"
import { mcpGatewayAccess } from './gateway'
import { mcpServersDataAccess } from './index'

const registerInput = z.object({
  name: z.string().min(1, '名称必填').max(200),
  description: z.string().max(5000).nullish(),
  descriptionEn: z.string().max(5000).nullish(),
  transport: z.enum(['http', 'sse', 'stdio']).default('http'),
  endpoint: z.string().max(2000).nullish(),
  hosting: z.enum(['self_hosted', 'platform_managed']).default('self_hosted'),
  scope: z.enum(['public', 'private', 'team']).default('public'),
  tools: z.array(z.record(z.string(), z.unknown())).max(200).nullish(),
  categoryId: z.string().nullish(),
  priceType: z.enum(['free', 'paid']).default('free'),
  priceAmount: z.union([z.string(), z.number()]).nullish(),
  billingModel: z.enum(['one_time', 'subscription', 'pay_per_call']).nullish(),
  unitPrice: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().max(3).optional(),
})

export const mcpServersRouter = createTRPCRouter({
  getMcpServers: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(18),
        search: z.string().optional(),
        transport: z.enum(['http', 'sse', 'stdio']).optional(),
        scope: z.enum(['public', 'private', 'team']).optional(),
        sort: z.enum(['date-desc', 'downloads-desc', 'views-desc']).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const list = await mcpServersDataAccess.getMcpServers(input)
        const total = await mcpServersDataAccess.getMcpServersCount(input)
        return {
          success: true,
          data: list,
          pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
        }
      } catch (error) {
        return failResult(error, '获取 MCP 服务列表失败')
      }
    }),

  getMcpServerById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const data = await mcpServersDataAccess.getMcpServerById(input.id)
      if (!data) return { success: false, error: 'MCP 服务未找到' }
      await mcpServersDataAccess.incrementViews(input.id)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取 MCP 服务详情失败')
    }
  }),

  getRelatedMcpServers: publicProcedure
    .input(z.object({ id: z.string(), limit: z.number().min(1).max(12).default(6) }))
    .query(async ({ input }) => {
      try {
        const data = await mcpServersDataAccess.getRelatedMcpServers({ id: input.id, limit: input.limit })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '获取相关 MCP 服务失败')
      }
    }),

  getMyMcpServers: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id).catch(() => ({ authorId: null }))
      if (!authorId) return { success: true, data: [] }
      const data = await mcpServersDataAccess.getMyMcpServers(authorId)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取我的 MCP 服务失败')
    }
  }),

  register: protectedProcedure.input(registerInput).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
        requirePayChannel: input.priceType === 'paid',
      })
      const data = await mcpServersDataAccess.registerMcpServer(authorId, input)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '注册 MCP 服务失败')
    }
  }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId) return { success: true, data: [] }
      const data = await mcpGatewayAccess.listMine(authorId)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取我的 MCP 资产失败')
    }
  }),

  getMine: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const data = await mcpGatewayAccess.getMineById(authorId, input.id)
      if (!data) return { success: false, error: '资产不存在' }
      return { success: true, data }
    } catch (error) {
      return failResult(error, '获取 MCP 资产失败')
    }
  }),

  checkName: protectedProcedure.input(z.object({ name: z.string().min(1).max(80) })).query(async ({ ctx, input }) => {
    try {
      if (!isValidAssetName(input.name)) return { success: true, taken: false, valid: false }
      const { authorId, username } = await requireAuthorForUser(ctx.user.id)
      const taken = await mcpGatewayAccess.isNameTaken(authorId, input.name, username)
      return { success: true, taken, valid: true }
    } catch (error) {
      return failResult(error, '检查名称失败')
    }
  }),

  discover: protectedProcedure
    .input(z.object({ url: z.string().url(), auth: gatewayAuthInput.optional() }))
    .mutation(async ({ input }) => {
      try {
        const data = await mcpGatewayAccess.discover(input.url, input.auth ?? { type: 'none' })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '自动发现失败')
      }
    }),

  test: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        transport: z.enum(['streamable', 'sse']).default('streamable'),
        auth: gatewayAuthInput.optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const data = await mcpGatewayAccess.test(input.url, input.transport, input.auth ?? { type: 'none' })
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
          transport: z.enum(['streamable', 'sse']).default('streamable'),
          auth: gatewayAuthInput.optional(),
          healthCheckEnabled: z.boolean().optional(),
          logoUrl: z.string().url().optional(),
          coverUrl: z.string().url().optional(),
          tools: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
        })
        .merge(listingInput)
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!isValidAssetName(input.assetName)) return { success: false, error: '名称格式无效' }
        const { authorId, username } = await requireAuthorForUser(ctx.user.id)
        const data = await mcpGatewayAccess.connect({
          authorId,
          providerSlug: username,
          assetName: input.assetName,
          displayName: input.displayName,
          url: input.url,
          transport: input.transport,
          auth: input.auth ?? { type: 'none' },
          healthCheckEnabled: input.healthCheckEnabled,
          description: input.description,
          categoryId: input.categoryId,
          scope: input.scope,
          priceType: input.priceType,
          priceAmount: input.priceAmount,
          billingModel: input.billingModel,
          unitPrice: input.unitPrice,
          logoUrl: input.logoUrl,
          coverUrl: input.coverUrl,
          tools: input.tools,
        })
        return { success: true, data }
      } catch (error) {
        return failResult(error, '接入 MCP 失败')
      }
    }),

  publish: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      // 提交上架前确认实名；付费资产在 connect 时已写入 priceType，此处再读库校验收款
      const mine = await mcpGatewayAccess.getMineById((await requireAuthorForUser(ctx.user.id)).authorId, input.id)
      const { authorId } = await requireVerifiedProviderForPublish(ctx.user.id, {
        requirePayChannel: mine?.price?.type === 'paid',
      })
      const data = await mcpGatewayAccess.publish(authorId, input.id)
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
        const data = await mcpGatewayAccess.toggle(authorId, input.id, input.enabled)
        return { success: true, data }
      } catch (error) {
        return failResult(error, '更新状态失败')
      }
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      await mcpGatewayAccess.remove(authorId, input.id)
      return { success: true }
    } catch (error) {
      return failResult(error, '删除失败')
    }
  }),

  retest: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const { authorId } = await requireAuthorForUser(ctx.user.id)
      const data = await mcpGatewayAccess.retest(authorId, input.id)
      return { success: true, data }
    } catch (error) {
      return failResult(error, '重新测试失败')
    }
  }),

  invokeTool: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        toolName: z.string().min(1).max(200),
        args: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const data = await mcpGatewayAccess.invokeTool(authorId, input.id, input.toolName, input.args)
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
        const serverName = `${username}__${input.assetName}`
        
        // 生成回调 URL
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:30021'
        const redirectUri = `${baseUrl}/api/oauth/callback/mcp`
        
        // `state` 必须签名：回调端点是公开的 GET 路由，base64 是编码不是
        // 加密，不签名的话攻击者能自己造一个把任意 code 写到别人资产上。
        const signed = signOAuthState({ assetName: serverName, authorId })
        if (!signed.ok) {
          console.error('[mcp/startOAuth] cannot sign state:', signed.reason)
          return failResult(new Error(signed.reason), 'startOAuth.state_sign_failed')
        }
        const state = signed.state
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
            state 
          } 
        }
      } catch (error) {
        return failResult(error, '启动 OAuth 授权失败')
      }
    }),

  checkOAuthStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const { authorId } = await requireAuthorForUser(ctx.user.id)
        const asset = await mcpGatewayAccess.getMineById(authorId, input.id)
        if (!asset) return { success: false, error: '资产不存在' }
        
        const metadata = (asset as any).metadata as Record<string, unknown> | null
        const oauthStatus = metadata?.oauthStatus as string | undefined
        const oauthAuthorizedAt = metadata?.oauthAuthorizedAt as string | undefined
        
        return { 
          success: true, 
          data: { 
            status: oauthStatus || 'unauthorized',
            authorizedAt: oauthAuthorizedAt 
          } 
        }
      } catch (error) {
        return failResult(error, '查询 OAuth 状态失败')
      }
    }),
})
