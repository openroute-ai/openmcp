import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpServers } from "@workspace/db"
import { discoverMcp, testMcpConnection } from "@/lib/gateway/mcp-connect"
import { toGatewayName } from "@/lib/gateway/names"
import { decryptSecret, encryptSecret } from "@/lib/gateway/secrets"
import {
  type AuthConfigInput,
  fromDbAuth,
  type McpTransportUi,
  toDbAuth,
  toLiteLLMAuthType,
  toLiteLLMTransport,
} from "@/lib/gateway/types"
import { getMcpGateway, isLiteLLMConfigured } from "@workspace/litellm"
import { mapMcpRow } from "@/web/assets/map-asset"
import { notDeleted } from "@/web/assets/visibility"
import { mcpServersDataAccess } from "./index"

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

export const mcpGatewayAccess = {
  listMine: async (authorId: string) => {
    const rows = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.authorId, authorId), notDeleted(mcpServers)))
      .orderBy(desc(mcpServers.createdAt))
    return rows.map((row) =>
      mapMcpRow({
        ...row,
        priceAmount: row.priceAmount?.toString() ?? null,
        unitPrice: row.unitPrice?.toString() ?? null,
        rejectReason: rejectNote(row.metadata),
      })
    )
  },

  getMineById: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, id),
          eq(mcpServers.authorId, authorId),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    if (!row) return null
    return mapMcpRow({
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
    const serverName = toGatewayName(providerSlug, assetName)
    const [existing] = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.authorId, authorId),
          eq(mcpServers.serverName, serverName),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    return Boolean(existing)
  },

  discover: (url: string, auth: AuthConfigInput) => discoverMcp(url, auth),

  test: (url: string, transport: McpTransportUi, auth: AuthConfigInput) =>
    testMcpConnection({ url, transport, auth }),

  connect: async (input: {
    authorId: string
    providerSlug: string
    assetName: string
    displayName?: string
    url: string
    transport: McpTransportUi
    auth: AuthConfigInput
    healthCheckEnabled?: boolean
    description?: string | null
    categoryId?: string | null
    scope?: "public" | "private" | "team"
    priceType?: "free" | "paid"
    priceAmount?: string | number | null
    billingModel?: "one_time" | "subscription" | "pay_per_call" | null
    unitPrice?: string | number | null
    logoUrl?: string | null
    coverUrl?: string | null
    tools?: Record<string, unknown>[]
  }) => {
    const test = await testMcpConnection({
      url: input.url,
      transport: input.transport,
      auth: input.auth,
    })
    if (!test.ok) {
      throw new Error("连接测试未通过，无法保存")
    }

    const serverName = toGatewayName(input.providerSlug, input.assetName)
    const taken = await mcpGatewayAccess.isNameTaken(
      input.authorId,
      input.assetName,
      input.providerSlug
    )
    if (taken) throw new Error("该名称已被使用，请更换")

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

    let litellmServerId: string | null = null
    if (isLiteLLMConfigured()) {
      const gw = getMcpGateway()
      const created = await gw.createServer({
        server_name: serverName,
        alias: serverName,
        url: input.url,
        transport: toLiteLLMTransport(input.transport),
        description: input.description ?? undefined,
        auth_type: toLiteLLMAuthType(input.auth.type) as
          | "none"
          | "api_key"
          | "bearer_token"
          | "basic"
          | "authorization"
          | "oauth2",
        auth_value: input.auth.secret || undefined,
        oauth2_flow:
          input.auth.type === "oauth_client"
            ? "client_credentials"
            : input.auth.type === "platform_oauth"
              ? "authorization_code"
              : undefined,
        client_id: input.auth.clientId || undefined,
        client_secret: input.auth.clientSecret || undefined,
        token_url: input.auth.tokenUrl || undefined,
        authorization_url: input.auth.authorizationUrl || undefined,
        scopes: input.auth.scopes || undefined,
        mcp_info: { description: input.description ?? undefined },
        allowed_tools: test.toolNames ?? [],
      })
      litellmServerId = created.server_id
    }

    const slug = `${input.providerSlug}/${input.assetName}`
    const [inserted] = await db
      .insert(mcpServers)
      .values({
        referenceId: slug,
        slug,
        name: input.displayName || input.assetName,
        description: input.description ?? null,
        logoUrl: input.logoUrl ?? null,
        coverUrl: input.coverUrl ?? null,
        transport: toLiteLLMTransport(input.transport),
        endpoint: input.url,
        serverName,
        authType: toDbAuth(input.auth.type),
        authConfig,
        connectionStatus: "online",
        lastTestedAt: new Date(),
        lastTestResult: test,
        healthCheckEnabled: input.healthCheckEnabled ?? false,
        litellmServerId,
        hosting: "self_hosted",
        scope: input.scope ?? "public",
        tools: input.tools ?? (test.toolNames ?? []).map((name) => ({ name })),
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
      throw new Error("MCP Server 保存失败")
    }

    return mcpGatewayAccess.getMineById(input.authorId, inserted.id)
  },

  publish: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, id),
          eq(mcpServers.authorId, authorId),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    if (row.connectionStatus !== "online") throw new Error("请先通过连接测试")
    await db
      .update(mcpServers)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(mcpServers.id, id))
    return mcpGatewayAccess.getMineById(authorId, id)
  },

  toggle: async (authorId: string, id: string, enabled: boolean) => {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, id),
          eq(mcpServers.authorId, authorId),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")

    if (!enabled) {
      // 停用即下架。市场可见性要求 `connectionStatus = 'online'`，所以只改
      // connectionStatus 就够了：`status` 保持 published，重新启用后能自动回到
      // 市场，不需要重新走一遍审核。
      await db
        .update(mcpServers)
        .set({ connectionStatus: "disabled", updatedAt: new Date() })
        .where(eq(mcpServers.id, id))
      return mcpGatewayAccess.getMineById(authorId, id)
    }

    // 重新启用必须复查连接，不能直接改回 online。
    //
    // 停用的常见原因是端点挂了、密钥过期、URL 改了。如果"启用"只是把一个
    // 布尔量翻回去，那么提供方会在没验证过的情况下把一个仍然坏着的端点重新
    // 挂上市场，买家付钱后才发现调不通。复查失败就保持 disabled。
    const test = await testMcpConnection({
      url: row.endpoint ?? "",
      transport: row.transport === "sse" ? "sse" : "streamable",
      auth: authFromRow(row.authConfig, row.authType),
    })
    await db
      .update(mcpServers)
      .set({
        connectionStatus: test.ok ? "online" : "error",
        lastTestedAt: new Date(),
        lastTestResult: test,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, id))
    if (!test.ok) {
      const failStep = test.steps?.find((s) => s.status === "fail")
      throw new Error(
        `重新启用失败，连接测试未通过：${failStep?.detail ?? "端点不可用"}`
      )
    }
    return mcpGatewayAccess.getMineById(authorId, id)
  },

  remove: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, id),
          eq(mcpServers.authorId, authorId),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    if (row.litellmServerId && isLiteLLMConfigured()) {
      try {
        await getMcpGateway().deleteServer(row.litellmServerId)
      } catch (error) {
        console.error("[mcp] delete from litellm failed", error)
      }
    }
    // 软删除，不删行。这张表挂着买家的购买记录和分成归属的引用：硬删要么被
    // 外键拒绝，要么让收入失去"这笔钱是谁赚的"这一原始凭据。行保留后对
    // 市场完全不可见（所有读取都带 `deleted_at is null`），但结算对账仍能
    // 追溯。
    await db
      .update(mcpServers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(mcpServers.id, id))
    return { ok: true }
  },

  retest: async (authorId: string, id: string) => {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, id),
          eq(mcpServers.authorId, authorId),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    const auth = authFromRow(row.authConfig, row.authType)
    const transport = row.transport === "sse" ? "sse" : "streamable"
    const result = await testMcpConnection({
      url: row.endpoint ?? "",
      transport,
      auth,
    })
    await db
      .update(mcpServers)
      .set({
        connectionStatus: result.ok ? "online" : "error",
        lastTestedAt: new Date(),
        lastTestResult: result,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, id))
    return result
  },

  invokeTool: async (
    authorId: string,
    id: string,
    toolName: string,
    args: Record<string, unknown>
  ) => {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, id),
          eq(mcpServers.authorId, authorId),
          notDeleted(mcpServers)
        )
      )
      .limit(1)
    if (!row) throw new Error("资产不存在")
    if (!row.litellmServerId || !isLiteLLMConfigured()) {
      throw new Error("该资产尚未注册到 LiteLLM 网关，无法试调")
    }
    const started = Date.now()
    const raw = await getMcpGateway().callTool(
      toolName,
      args,
      row.litellmServerId || row.serverName || undefined
    )
    return {
      ok: true,
      latencyMs: Date.now() - started,
      text: JSON.stringify(raw, null, 2).slice(0, 4000),
    }
  },
}

export { mcpServersDataAccess }
