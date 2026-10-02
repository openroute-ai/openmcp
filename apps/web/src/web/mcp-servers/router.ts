import { z } from 'zod'
import { failResult, gatewayAuthInput, listingInput } from "@/lib/gateway/input"
import { isValidAssetName } from "@/lib/gateway/names"
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/routers/trpc"
import { getAuthorForUser, requireAuthorForUser, requireVerifiedProviderForPublish } from "@/web/providers/author"
import { signOAuthState } from "@/lib/agent-install/oauth-state"
import { assetIsGated, checkAssetEntitlement, purchaseAsset } from './entitlement'
import { emptyPage, mineListInput } from '@/web/assets/mine-list'
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

  getMcpServerById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const data = await mcpServersDataAccess.getMcpServerById(input.id)
      if (!data) return { success: false, error: 'MCP 服务未找到' }
      await mcpServersDataAccess.incrementViews(input.id)

      /**
       * 付费资产的 `endpoint` 就是商品本身。未购买时在这里抹掉，而不是让前端自己
       * 判断 —— 前端判断迟早会漏（直接调这个 query 就拿到了），而且安装链路的门禁在
       * `install_asset`，两处口径必须一致。
       *
       * 匿名访客不查授权：查了也只是多一次注定拿不到授权的查询，而匿名用户本来
       * 就买不了，`access: null` 让 UI 走"登录后购买"。
       */
      const access = ctx.user?.id
        ? await checkAssetEntitlement({ userId: ctx.user.id, kind: 'mcp', assetId: input.id })
        : null

      // 匿名访客没有授权可查，`access` 是 null。null 绝不能等于"放行"：
      // 付费端点就是商品本身，未购买时必须抹掉。
      const gated = access === null ? await assetIsGated('mcp', input.id) : !access.allowed

      return {
        success: true as const,
        data: {
          ...data,
          endpoint: gated ? null : data.endpoint,
          access,
        },
      }
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

  listMine: protectedProcedure.input(mineListInput).query(async ({ ctx, input }) => {
    try {
      const { authorId } = await getAuthorForUser(ctx.user.id)
      if (!authorId) return { success: true, data: emptyPage() }
      return { success: true, data: await mcpGatewayAccess.listMine(authorId, input) }
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
            oauthStatus: oauthStatus || 'unauthorized',
            authorizedAt: oauthAuthorizedAt 
          } 
        }
      } catch (error) {
        return failResult(error, '查询 OAuth 状态失败')
      }
    }),

  /** 当前用户是否已购买该 MCP（免费资产恒为 true）。 */
  hasEntitlement: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const decision = await checkAssetEntitlement({
          userId: ctx.user.id,
          kind: 'mcp',
          assetId: input.id,
        })
        if (decision.allowed) {
          return { success: true as const, data: { entitled: true, reason: decision.reason } }
        }
        return {
          success: false as const,
          error: decision.error,
          code: decision.code,
          entitled: false,
        }
      } catch (error) {
        return failResult(error, '查询授权失败')
      }
    }),

  /**
   * 付费购买：钱包扣款 + 写入 mcp_server_entitlements。
   *
   * 只支持一次性付费。`pay_per_call` / `subscription` 在调用时结算，
   * 在这里扣款会与 spend 结算重复收费。
   *
   * 注意：本 mutation **不**产生 providerEarnings 分成行，理由见
   * `entitlement.ts` 的 `purchaseAsset`。在这条链路补齐之前，
   * MCP 销售不计入提供方账单。
   */
  createPurchase: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await purchaseAsset({
          userId: ctx.user.id,
          kind: 'mcp',
          assetId: input.id,
        })
        if (!result.ok) {
          return {
            success: false as const,
            error: result.error,
            code: result.code,
            needRecharge: result.needRecharge ?? false,
            rechargeUrl: result.rechargeUrl,
            requiredAmount: result.requiredAmount,
            balance: result.balance,
          }
        }
        return {
          success: true as const,
          data: {
            alreadyOwned: result.alreadyOwned,
            entitlementId: result.entitlementId,
            amount: result.amount,
            currency: result.currency,
            balanceAfter: result.balanceAfter,
          },
        }
      } catch (error) {
        return failResult(error, '购买失败')
      }
    }),
})
