import { and, count, desc, eq, ilike, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { a2aAgents } from "@workspace/db"
import type { MineListOptions } from "@/web/assets/mine-list"
import { discoverA2a, testA2aConnection } from "@/lib/gateway/a2a-connect"
import { toGatewayName } from "@/lib/gateway/names"
import { decryptSecret, encryptSecret } from "@/lib/gateway/secrets"
import {
  type A2aProtocolUi,
  type AuthConfigInput,
  fromDbAuth,
  toDbAuth,
} from "@/lib/gateway/types"
import { getA2aGateway, isLiteLLMConfigured } from "@workspace/litellm"
import { mapA2aRow } from "@/web/assets/map-asset"
import { notDeleted } from "@/web/assets/visibility"

function rejectNote(metadata: unknown): string | null {
  const m = (metadata ?? {}) as { reviewNote?: string }
  return m.reviewNote ?? null
}

function authFromRow(
  authConfig: unknown,
  authType: string | null
): AuthConfigInput {
  const cfg = (authConfig ?? {}) as { encrypted?: string; headerName?: string }
  let secret: string | undefined
  if (cfg.encrypted) {
    try {
      secret = decryptSecret(cfg.encrypted)
    } catch {
      secret = undefined
    }
  }
  return { type: fromDbAuth(authType), secret, headerName: cfg.headerName }
}

export const a2aGatewayAccess = {
  /** 名下资产：服务端搜索 + 分页，理由同 MCP 的 `listMine`。 */
  listMine: async (authorId: string, opts: MineListOptions = {}) => {
    const { search, status, page = 1, pageSize = 20 } = opts
    const where = [eq(a2aAgents.authorId, authorId), notDeleted(a2aAgents)]
    // status 在表上是枚举列，入参是 string：按该列自身的枚举收窄，避免塞进库外的值
    if (status) where.push(eq(a2aAgents.status, status as (typeof a2aAgents.status.enumValues)[number]))
    if (search) {
      const needle = `%${search}%`
      where.push(
        or(
          ilike(a2aAgents.name, needle),
          ilike(a2aAgents.slug, needle),
          ilike(a2aAgents.agentName, needle),
          ilike(a2aAgents.endpoint, needle)
        )!
      )
    }
    const whereExpr = and(...where)

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(a2aAgents)
        .where(whereExpr)
        .orderBy(desc(a2aAgents.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: count() }).from(a2aAgents).where(whereExpr),
    ])

    const total = totalRow?.n ?? 0
    return {
      items: rows.map((row) =>
        mapA2aRow({
          ...row,
          priceAmount: row.priceAmount?.toString() ?? null,
          unitPrice: row.unitPrice?.toString() ?? null,
          rejectReason: rejectNote(row.metadata),
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  },

  getMineById: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.id, id),
          eq(a2aAgents.authorId, authorId),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    if (!row) return null
    return mapA2aRow({
      ...row,
      priceAmount: row.priceAmount?.toString() ?? null,
      unitPrice: row.unitPrice?.toString() ?? null,
      rejectReason: rejectNote(row.metadata),
    })
  },

  isNameTaken: async (
    authorId: string,
    assetName: string,
    providerSlug: string
  ) => {
    const agentName = toGatewayName(providerSlug, assetName)
    const [existing] = await db
      .select({ id: a2aAgents.id })
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.authorId, authorId),
          eq(a2aAgents.agentName, agentName),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    return Boolean(existing)
  },

  discover: (url: string, auth: AuthConfigInput) => discoverA2a(url, auth),
  test: (url: string, protocol: A2aProtocolUi, auth: AuthConfigInput) =>
    testA2aConnection({ url, protocol, auth }),

  connect: async (input: {
    authorId: string
    providerSlug: string
    assetName: string
    displayName?: string
    url: string
    protocol: A2aProtocolUi
    auth: AuthConfigInput
    healthCheckEnabled?: boolean
    description?: string | null
    categoryId?: string | null
    visibility?: "public" | "private" | "team"
    priceType?: "free" | "paid"
    priceAmount?: string | number | null
    billingModel?: "one_time" | "subscription" | "pay_per_call" | null
    unitPrice?: string | number | null
    logoUrl?: string | null
    coverUrl?: string | null
  }) => {
    const test = await testA2aConnection({
      url: input.url,
      protocol: input.protocol,
      auth: input.auth,
    })
    if (!test.ok) throw new Error("连接测试未通过，无法保存")

    const agentName = toGatewayName(input.providerSlug, input.assetName)
    if (
      await a2aGatewayAccess.isNameTaken(
        input.authorId,
        input.assetName,
        input.providerSlug
      )
    ) {
      throw new Error("该名称已被使用，请更换")
    }

    const authConfig: Record<string, unknown> = { type: input.auth.type }
    if (input.auth.secret)
      authConfig.encrypted = encryptSecret(input.auth.secret)
    if (input.auth.headerName) authConfig.headerName = input.auth.headerName
    if (input.auth.clientId) authConfig.clientId = input.auth.clientId
    if (input.auth.clientSecret)
      authConfig.encrypted_client_secret = encryptSecret(
        input.auth.clientSecret
      )
    if (input.auth.tokenUrl) authConfig.tokenUrl = input.auth.tokenUrl
    if (input.auth.authorizationUrl)
      authConfig.authorizationUrl = input.auth.authorizationUrl
    if (input.auth.scopes) authConfig.scopes = input.auth.scopes

    const staticHeaders: Record<string, string> = {}
    if (input.auth.secret && input.auth.type === "bearer")
      staticHeaders.Authorization = `Bearer ${input.auth.secret}`
    if (input.auth.secret && input.auth.type === "api_key")
      staticHeaders[input.auth.headerName || "X-API-Key"] = input.auth.secret

    let litellmAgentId: string | null = null
    if (isLiteLLMConfigured()) {
      const created = await getA2aGateway().createAgent({
        agent_name: agentName,
        agent_card_params: {
          url: input.url,
          protocolVersion: input.protocol,
          name: input.displayName || input.assetName,
          description: input.description ?? test.description,
          ...(test.agentCard ?? {}),
        },
        static_headers:
          Object.keys(staticHeaders).length > 0 ? staticHeaders : undefined,
        // OAuth 参数（如果是 platform_oauth）
        ...(input.auth.type === "platform_oauth"
          ? {
              auth_type: "oauth2",
              oauth2_flow: "authorization_code",
              client_id: input.auth.clientId,
              client_secret: input.auth.clientSecret,
              token_url: input.auth.tokenUrl,
              authorization_url: input.auth.authorizationUrl,
              scopes: input.auth.scopes,
            }
          : {}),
      })
      litellmAgentId = created.agent_id
    }

    const slug = `${input.providerSlug}/${input.assetName}`
    const [inserted] = await db
      .insert(a2aAgents)
      .values({
        referenceId: slug,
        slug,
        name: input.displayName || input.assetName,
        description: input.description ?? test.description ?? null,
        logoUrl: input.logoUrl ?? null,
        coverUrl: input.coverUrl ?? null,
        agentCardUrl: input.url,
        endpoint: input.url,
        agentCard: test.agentCard ?? null,
        agentName,
        protocolVersion: input.protocol,
        authType: toDbAuth(input.auth.type),
        authConfig,
        connectionStatus: "online",
        lastTestedAt: new Date(),
        lastTestResult: test,
        healthCheckEnabled: input.healthCheckEnabled ?? false,
        litellmAgentId,
        visibility: input.visibility ?? "public",
        categoryId: input.categoryId ?? null,
        authorId: input.authorId,
        priceType: input.priceType ?? "free",
        priceAmount:
          input.priceAmount != null ? String(input.priceAmount) : null,
        billingModel: input.billingModel ?? null,
        unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
        currency: "CNY",
        status: "draft",
      })
      .returning()

    if (!inserted) {
      throw new Error("Agent 保存失败")
    }

    return a2aGatewayAccess.getMineById(input.authorId, inserted.id)
  },

  publish: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.id, id),
          eq(a2aAgents.authorId, authorId),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    if (row.connectionStatus !== "online") throw new Error("请先通过连接测试")
    await db
      .update(a2aAgents)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(a2aAgents.id, id))
    return a2aGatewayAccess.getMineById(authorId, id)
  },

  toggle: async (authorId: string, id: string, enabled: boolean) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.id, id),
          eq(a2aAgents.authorId, authorId),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")

    if (!enabled) {
      // 停用即下架：市场可见性要求 `connectionStatus = 'online'`。`status` 保持
      // published，重新启用通过复查后能自动回到市场。
      //
      // ⚠️ 待定（P3）：与 `mcp-servers/gateway.ts` 的 `toggle(false)` 是同一个
      // 未决问题，标记理由见那里的完整说明，简述：买家持有的是 LiteLLM 公网
      // 地址和已发放的 virtual key，平台侧没有 proxy，所以只改 DB 不会切断
      // 存量调用；`remove()` 会 deleteServer 而 `toggle(false)` 不会，两条路径
      // 行为不一致。停用是"停止服务"还是"停止售卖"属于产品语义，且 LiteLLM
      // 侧无法在本仓库验证，定下来后 MCP/A2A 要按同一套处理。
      await db
        .update(a2aAgents)
        .set({ connectionStatus: "disabled", updatedAt: new Date() })
        .where(eq(a2aAgents.id, id))
      return a2aGatewayAccess.getMineById(authorId, id)
    }

    // 重新启用必须复查连接，不能直接翻回 online。停用的常见原因是端点挂了、
    // Agent Card 过期、协议版本变了。
    const test = await testA2aConnection({
      url: row.endpoint ?? "",
      protocol: (row.protocolVersion === "0.3"
        ? "0.3"
        : "1.0") as A2aProtocolUi,
      auth: authFromRow(row.authConfig, row.authType),
    })
    await db
      .update(a2aAgents)
      .set({
        connectionStatus: test.ok ? "online" : "error",
        lastTestedAt: new Date(),
        lastTestResult: test,
        updatedAt: new Date(),
      })
      .where(eq(a2aAgents.id, id))
    if (!test.ok) {
      const failStep = test.steps?.find((s) => s.status === "fail")
      throw new Error(
        `重新启用失败，连接测试未通过：${failStep?.detail ?? "端点不可用"}`
      )
    }
    return a2aGatewayAccess.getMineById(authorId, id)
  },

  remove: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.id, id),
          eq(a2aAgents.authorId, authorId),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    if (row.litellmAgentId && isLiteLLMConfigured()) {
      try {
        await getA2aGateway().deleteAgent(row.litellmAgentId)
      } catch (error) {
        console.error("[a2a] delete from litellm failed", error)
      }
    }
    // 软删除，理由同 `mcpGatewayAccess.remove`：保住买家购买记录与分成归属。
    await db
      .update(a2aAgents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(a2aAgents.id, id))
    return { ok: true }
  },

  /**
   * 定时健康检查用的探测：不校验 `authorId`，也不写 `connectionStatus`。
   * 理由与 MCP 侧的 `probeSystem` 相同——写库策略（连续失败几次才下架）在调用方，
   * 不在这里，免得改阈值要改两个探测实现。
   */
  probeSystem: async (id: string) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(and(eq(a2aAgents.id, id), notDeleted(a2aAgents)))
      .limit(1)
    if (!row) throw new Error("资产不存在")
    const auth = authFromRow(row.authConfig, row.authType)
    const protocol = (
      row.protocolVersion === "0.3" ? "0.3" : "1.0"
    ) as A2aProtocolUi
    return testA2aConnection({
      url: row.endpoint || row.agentCardUrl || "",
      protocol,
      auth,
    })
  },

  retest: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.id, id),
          eq(a2aAgents.authorId, authorId),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    const auth = authFromRow(row.authConfig, row.authType)
    const protocol = (
      row.protocolVersion === "0.3" ? "0.3" : "1.0"
    ) as A2aProtocolUi
    const result = await testA2aConnection({
      url: row.endpoint || row.agentCardUrl || "",
      protocol,
      auth,
    })
    await db
      .update(a2aAgents)
      .set({
        connectionStatus: result.ok ? "online" : "error",
        lastTestedAt: new Date(),
        lastTestResult: result,
        agentCard: result.agentCard ?? row.agentCard,
        updatedAt: new Date(),
      })
      .where(eq(a2aAgents.id, id))
    return result
  },

  invoke: async (authorId: string, id: string, message: string) => {
    const [row] = await db
      .select()
      .from(a2aAgents)
      .where(
        and(
          eq(a2aAgents.id, id),
          eq(a2aAgents.authorId, authorId),
          notDeleted(a2aAgents)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    if (!row.litellmAgentId && !row.agentName)
      throw new Error("该资产尚未注册到 LiteLLM 网关，无法试调")
    if (!isLiteLLMConfigured()) throw new Error("LiteLLM 未配置")
    const started = Date.now()
    const agentId = row.litellmAgentId || row.agentName || id
    const raw = await getA2aGateway().sendMessage(agentId, message)
    return {
      ok: true,
      latencyMs: Date.now() - started,
      text: JSON.stringify(raw, null, 2).slice(0, 4000),
    }
  },
}
