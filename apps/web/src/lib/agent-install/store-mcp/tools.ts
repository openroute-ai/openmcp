import { eq, sql } from 'drizzle-orm'
import { a2aAgents, authors, mcpServers, skills } from '@workspace/db'
import {
  buildA2aAgentCardUrl,
  buildA2aGatewayUrl,
  buildAssetDetailUrl,
  buildMcpGatewayUrl,
  buildStoreMcpUrl,
  getAppBaseUrl,
  API_KEY_PLACEHOLDER,
  API_KEYS_PATH,
  GATEWAY_KEY_HEADER,
} from '@/lib/agent-install/urls'
import { buildMcpJsonSnippet } from '@/lib/agent-install/prompts'
import type { AssetKind, RuntimeId } from '@/lib/agent-install/types'
import { db } from '@/lib/db'
import { acquireSkill } from '@/web/skills/acquire'
import { buildSkillPackage, buildMinimalSkillPackage } from '@/lib/agent-install/skill-package'
import { filesFromSkillRow } from '@/lib/security-scan'
import { recommendCatalogAssets } from '@/web/catalog/recommend'
import { searchCatalog } from '@/web/catalog/search'
import type { CatalogKind } from '@/web/catalog/types'
import { checkAssetEntitlement } from '@/web/mcp-servers/entitlement'
import { recordAssetInstall } from '@/web/assets/installs'
import type { StoreAuthResult } from './auth'
import { resolveA2a, resolveMcp } from './resolve'
import { createDeviceCode } from './oauth'

export const STORE_MCP_TOOLS = [
  {
    name: 'search_assets',
    description:
      '结构化搜索已上架资产（Skill / MCP / A2A / App=工作流）。支持 kind、tags、category、priceType、securityGrade；默认按热度分（downloads+时效+安全评级）排序。可匿名。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '搜索词（标题/slug/描述，中文友好）' },
        kind: {
          type: 'string',
          enum: ['skill', 'mcp', 'a2a', 'app'],
          description: '资产类型；app 对应 workflows',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签过滤（需全部命中）',
        },
        categorySlug: { type: 'string', description: '分类 slug' },
        priceType: { type: 'string', enum: ['free', 'paid'], description: '免费/付费' },
        securityGrade: {
          type: 'string',
          enum: ['safe', 'caution', 'unsafe', 'reject', 'unknown'],
          description: '最低可接受安全评级',
        },
        sort: {
          type: 'string',
          enum: ['hot', 'downloads', 'recent'],
          description: '排序：hot=热度分（默认）',
        },
        limit: { type: 'number', description: '条数 1-50，默认 10' },
      },
      required: [],
    },
  },
  {
    name: 'recommend_assets',
    description:
      'Chat / AI 选型推荐：根据场景描述（useCase）返回混合类型资产清单 + 推荐理由。内部复用结构化 catalog search 与热度排序。可匿名。',
    inputSchema: {
      type: 'object',
      properties: {
        useCase: {
          type: 'string',
          description: '选型场景 / 需求描述，例如「需要一个能查天气的 MCP」',
        },
        kind: {
          type: 'string',
          enum: ['skill', 'mcp', 'a2a', 'app'],
          description: '可选类型过滤',
        },
        priceType: { type: 'string', enum: ['free', 'paid'] },
        preferFree: { type: 'boolean', description: '默认 true：同等条件下偏免费' },
        securityGrade: {
          type: 'string',
          enum: ['safe', 'caution', 'unsafe', 'reject', 'unknown'],
          description: '最低安全评级，默认 caution',
        },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: '条数 1-20，默认 5' },
      },
      required: ['useCase'],
    },
  },
  {
    name: 'get_asset',
    description: '按 id/slug 获取已上架资产详情与安装元数据。可匿名。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['skill', 'mcp', 'a2a'] },
        id: { type: 'string', description: '资产 uuid 或 slug' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'install_asset',
    description:
      '为指定 runtime 安装已上架资产。需要鉴权（API Key 或 OAuth）。付费 Skill / MCP / A2A 需先购买（entitlement），未购买时返回 NEED_PURCHASE 与购买链接。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['skill', 'mcp', 'a2a'] },
        id: { type: 'string', description: '资产 uuid 或 slug' },
        runtime: {
          type: 'string',
          enum: ['cursor', 'claude-code', 'codex', 'generic-prompt'],
          description: '目标 Agent runtime（默认 cursor）',
        },
        version: { type: 'string', description: '可选 Skill 版本' },
      },
      required: ['kind', 'id'],
    },
  },
] as const

type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  structuredContent?: unknown
}

function textResult(payload: unknown, isError = false): ToolCallResult {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    isError,
    structuredContent: typeof payload === 'string' ? undefined : payload,
  }
}

function clampLimit(n: unknown, fallback = 10): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(1, Math.min(50, Math.floor(v)))
}

async function resolveSkill(idOrSlug: string) {
  const byId = await db.select().from(skills).where(eq(skills.id, idOrSlug)).limit(1)
  if (byId[0]) return byId[0]
  const bySlug = await db.select().from(skills).where(eq(skills.slug, idOrSlug)).limit(1)
  return bySlug[0] ?? null
}

async function authRequiredPayload(): Promise<ToolCallResult> {
  const device = await createDeviceCode()
  return textResult(
    {
      error: 'authentication_required',
      message:
        'install_asset 需要登录。请使用 Dashboard API Key（Authorization: Bearer sk-… / omk_…），或完成 Device Code 授权。',
      device_code: device.device_code,
      user_code: device.user_code,
      verification_uri: device.verification_uri,
      verification_uri_complete: device.verification_uri_complete,
      expires_in: device.expires_in,
      interval: device.interval,
      token_url: `${getAppBaseUrl()}/api/mcp/store/oauth/token`,
      api_keys_path: API_KEYS_PATH,
      hint: `打开 ${device.verification_uri} 并输入代码 ${device.user_code}；随后 POST ${getAppBaseUrl()}/api/mcp/store/oauth/token 换取 access_token。`,
    },
    true
  )
}

export async function callStoreTool(
  name: string,
  args: Record<string, unknown>,
  authResult: StoreAuthResult,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null }
): Promise<ToolCallResult> {
  switch (name) {
    case 'search_assets': {
      const q = args.q != null ? String(args.q).trim() : undefined
      const kind = args.kind ? (String(args.kind) as CatalogKind) : undefined
      const limit = clampLimit(args.limit)
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined
      const categorySlug = args.categorySlug ? String(args.categorySlug) : undefined
      const priceType =
        args.priceType === 'free' || args.priceType === 'paid' ? args.priceType : undefined
      const securityGrade = args.securityGrade ? String(args.securityGrade) : undefined
      const sort =
        args.sort === 'downloads' || args.sort === 'recent' || args.sort === 'hot'
          ? args.sort
          : 'hot'

      const { assets, total } = await searchCatalog({
        q,
        kind,
        tags,
        categorySlug,
        priceType,
        securityGrade: securityGrade as
          | 'safe'
          | 'caution'
          | 'unsafe'
          | 'reject'
          | 'unknown'
          | undefined,
        sort,
        limit,
      })
      return textResult({
        assets,
        total,
        sort,
        ranking:
          'hot_score = ln(1+downloads)*2 + recency(30d)*0.35 + security_weight + certified_boost',
      })
    }

    case 'recommend_assets': {
      const useCase = String(args.useCase ?? args.q ?? '').trim()
      if (!useCase) return textResult({ error: '缺少参数 useCase（选型场景描述）' }, true)
      const kind = args.kind ? (String(args.kind) as CatalogKind) : undefined
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined
      const priceType =
        args.priceType === 'free' || args.priceType === 'paid' ? args.priceType : undefined
      const preferFree = args.preferFree === undefined ? undefined : Boolean(args.preferFree)
      const securityGrade = args.securityGrade ? String(args.securityGrade) : undefined
      const limit = clampLimit(args.limit, 5)

      const { recommendations, query } = await recommendCatalogAssets({
        useCase,
        kind,
        tags,
        priceType,
        preferFree,
        securityGrade: securityGrade as
          | 'safe'
          | 'caution'
          | 'unsafe'
          | 'reject'
          | 'unknown'
          | undefined,
        limit: Math.min(20, limit),
      })
      return textResult({
        query,
        recommendations,
        hint: 'Chat 选型可直接展示 reason；安装请再调 install_asset（需登录）。',
      })
    }

    case 'get_asset': {
      const kind = args.kind as AssetKind
      const id = String(args.id ?? '').trim()
      if (!kind || !id) return textResult({ error: '缺少 kind 或 id' }, true)

      if (kind === 'skill') {
        const skill = await resolveSkill(id)
        if (!skill || skill.status !== 'published') {
          return textResult({ error: '技能未找到或未上架' }, true)
        }
        return textResult({
          kind: 'skill',
          id: skill.id,
          slug: skill.slug,
          title: skill.title,
          description: skill.description,
          version: skill.version,
          priceType: skill.priceType,
          priceAmount: skill.priceAmount,
          securityGrade: skill.securityGrade,
          certified: skill.certified,
          platforms: skill.platforms,
          downloads: skill.downloads,
          detailUrl: buildAssetDetailUrl('skill', skill.slug),
          packageUrl: `${getAppBaseUrl()}/api/skills/${skill.slug}/package`,
          installDocUrl: `${getAppBaseUrl()}/install/openmcp.md`,
        })
      }

      if (kind === 'mcp') {
        const row = await resolveMcp(id)
        if (!row || row.status !== 'published') {
          return textResult({ error: 'MCP 未找到或未上架' }, true)
        }
        return textResult({
          kind: 'mcp',
          id: row.id,
          slug: row.slug,
          title: row.name,
          description: row.description,
          priceType: row.priceType,
          priceAmount: row.priceAmount,
          billingModel: row.billingModel,
          certified: row.certified,
          serverName: row.serverName,
          detailUrl: buildAssetDetailUrl('mcp', row.slug),
          // 付费资产不返回 gatewayUrl：`get_asset` 可匿名调用，而付费资产的
          // 接入方式正是收费的东西 —— 匿名拿到 URL 就等于白嫖。安装走
          // `install_asset`，那里才有门禁。
          //
          // 免费资产照常返回：它没有需要保护的东西，藏起来只是让免费 MCP
          // 少了"这条 URL 怎么用"这条信息，用户还得先安装一遍才知道。
          gatewayUrl: row.priceType === 'paid' || !row.serverName ? null : buildMcpGatewayUrl(row.serverName),
          installHint: '调用 install_asset 完成安装并获取 gatewayUrl',
          note: '仅平台网关 URL，禁止使用 Provider 直连 endpoint',
        })
      }

      if (kind === 'a2a') {
        const row = await resolveA2a(id)
        if (!row || row.status !== 'published') {
          return textResult({ error: 'A2A 未找到或未上架' }, true)
        }
        return textResult({
          kind: 'a2a',
          id: row.id,
          slug: row.slug,
          title: row.name,
          description: row.description,
          priceType: row.priceType,
          priceAmount: row.priceAmount,
          billingModel: row.billingModel,
          certified: row.certified,
          agentName: row.agentName,
          detailUrl: buildAssetDetailUrl('a2a', row.slug),
          // 同 MCP：付费资产的 gatewayUrl 不能从匿名入口出去。
          gatewayUrl: row.priceType === 'paid' || !row.agentName ? null : buildA2aGatewayUrl(row.agentName),
          agentCardUrl: null,
          installHint: '调用 install_asset 完成安装并获取 gatewayUrl',
          note: '仅平台网关 URL，禁止使用 Provider 直连 endpoint',
        })
      }

      return textResult({ error: `不支持的 kind: ${kind}` }, true)
    }

    case 'install_asset': {
      if (!authResult.userId) {
        return authRequiredPayload()
      }

      const kind = args.kind as AssetKind
      const id = String(args.id ?? '').trim()
      const runtime = (String(args.runtime ?? 'cursor') as RuntimeId) || 'cursor'
      const version = args.version ? String(args.version) : undefined
      if (!kind || !id) return textResult({ error: '缺少 kind 或 id' }, true)

      if (kind === 'skill') {
        const skill = await resolveSkill(id)
        if (!skill || skill.status !== 'published') {
          return textResult({ error: '技能未找到或未上架' }, true)
        }

        const acquired = await acquireSkill({
          skillId: skill.id,
          userId: authResult.userId,
          locale: 'zh',
          ipAddress: requestMeta?.ipAddress,
          userAgent: requestMeta?.userAgent,
          version,
        })

        if (!acquired.ok) {
          const purchaseUrl = `${getAppBaseUrl()}/skills/${skill.slug}`
          return textResult(
            {
              error: acquired.code,
              message: acquired.error,
              purchaseUrl: acquired.code === 'NEED_PURCHASE' ? purchaseUrl : undefined,
            },
            true
          )
        }

        const [author] = skill.authorId
          ? await db.select().from(authors).where(eq(authors.id, skill.authorId)).limit(1)
          : [null]

        let files: { path: string; content: string }[] = []
        let name = skill.slug
        let targetDirs: Record<string, string> | undefined

        if (acquired.delivery.kind === 'github') {
          const pkg = buildMinimalSkillPackage({
            id: skill.id,
            slug: skill.slug,
            title: skill.title,
            description: skill.description ?? skill.readme,
            version: skill.version,
            priceType: skill.priceType === 'paid' ? 'paid' : 'free',
            authorName: author?.name ?? undefined,
            authorId: author?.id ?? undefined,
          })
          files = pkg.files
          name = pkg.name
          targetDirs = pkg.targetDirs
        } else {
          const sourceFiles =
            acquired.delivery.files.length > 0
              ? acquired.delivery.files
              : await filesFromSkillRow({
                  readme: skill.readme,
                  readmeEn: skill.readmeEn,
                  metadata: skill.metadata,
                })
          const pkg = buildSkillPackage({
            id: skill.id,
            slug: skill.slug,
            title: skill.title,
            description: skill.description ?? null,
            readme: skill.readme,
            readmeEn: skill.readmeEn,
            version: acquired.delivery.version || skill.version || '1.0.0',
            priceType: skill.priceType === 'paid' ? 'paid' : 'free',
            authorName: author?.name ?? undefined,
            authorId: author?.id ?? undefined,
            sourceFiles,
          })
          files = pkg.files
          name = pkg.name
          targetDirs = pkg.targetDirs
        }

        return textResult({
          kind: 'skill',
          id: skill.id,
          slug: skill.slug,
          name,
          runtime,
          version: acquired.delivery.version,
          files,
          targetDirs,
          delivery: acquired.delivery.kind === 'github'
            ? { kind: 'github', githubUrl: acquired.delivery.githubUrl, installNotes: acquired.delivery.installNotes }
            : { kind: 'files' },
          packageUrl: `${getAppBaseUrl()}/api/skills/${skill.slug}/package`,
          installCallbackUrl: `${getAppBaseUrl()}/api/skills/${skill.slug}/install-callback`,
          installTips: acquired.delivery.installTips,
          riskWarning: acquired.delivery.riskWarning,
          note: '请将 files 写入本地 skills 目录；安装成功后可 POST installCallbackUrl 登记。',
        })
      }

      if (kind === 'mcp') {
        const row = await resolveMcp(id)
        if (!row || row.status !== 'published') {
          return textResult({ error: 'MCP 未找到或未上架' }, true)
        }
        if (!row.serverName) {
          return textResult({ error: '该 MCP 尚未绑定平台网关 serverName' }, true)
        }

        // 付费门禁必须在发出 gatewayUrl 之前。放在这之后等于把收费资产的
        // 接入方式先发出去再问要不要付钱。
        const mcpEntitlement = await checkAssetEntitlement({
          userId: authResult.userId,
          kind: 'mcp',
          assetId: row.id,
        })
        if (!mcpEntitlement.allowed) {
          return textResult(
            {
              error: mcpEntitlement.code,
              message: mcpEntitlement.error,
              priceType: row.priceType,
              priceAmount: row.priceAmount?.toString() ?? null,
              purchaseUrl: `${getAppBaseUrl()}/mcp/${row.slug}`,
            },
            true
          )
        }
        const gatewayUrl = buildMcpGatewayUrl(row.serverName)
        const snippet = buildMcpJsonSnippet({
          label: row.slug || row.serverName,
          url: gatewayUrl,
          runtime,
          headerName: GATEWAY_KEY_HEADER,
          comment: '平台网关，勿用创作者直连',
        })
        // bump download counter (best-effort)
        await db
          .update(mcpServers)
          .set({ downloads: sql`${mcpServers.downloads} + 1`, updatedAt: new Date() })
          .where(eq(mcpServers.id, row.id))

        // 调用即安装：拿到 gatewayUrl 就等于装上了，同步记一条安装。
        await recordAssetInstall({
          userId: authResult.userId,
          assetType: 'mcp',
          assetId: row.id,
          assetName: row.serverName,
          source: 'install',
        })

        return textResult({
          kind: 'mcp',
          id: row.id,
          slug: row.slug,
          runtime,
          gatewayUrl,
          serverName: row.serverName,
          configSnippet: snippet,
          apiKeyPlaceholder: API_KEY_PLACEHOLDER,
          apiKeysPath: API_KEYS_PATH,
          // 按次付费资产没有"已购买"这个状态，值得在安装结果里说明：否则
          // Agent 会以为装完就免费可用，实际每次调用都在扣余额。
          billing:
            mcpEntitlement.reason === 'metered'
              ? 'metered：安装不收费，每次调用按量从账户余额扣除'
              : undefined,
          note: '仅平台网关；请用 Dashboard 签发的 Virtual Key。禁止 Provider endpoint。',
        })
      }

      if (kind === 'a2a') {
        const row = await resolveA2a(id)
        if (!row || row.status !== 'published') {
          return textResult({ error: 'A2A 未找到或未上架' }, true)
        }
        if (!row.agentName) {
          return textResult({ error: '该 A2A 尚未绑定平台网关 agentName' }, true)
        }

        // 同 MCP 侧：门禁在发出 gatewayUrl / Agent Card 之前。
        const a2aEntitlement = await checkAssetEntitlement({
          userId: authResult.userId,
          kind: 'a2a',
          assetId: row.id,
        })
        if (!a2aEntitlement.allowed) {
          return textResult(
            {
              error: a2aEntitlement.code,
              message: a2aEntitlement.error,
              priceType: row.priceType,
              priceAmount: row.priceAmount?.toString() ?? null,
              purchaseUrl: `${getAppBaseUrl()}/a2a/${row.slug}`,
            },
            true
          )
        }
        await db
          .update(a2aAgents)
          .set({ downloads: sql`${a2aAgents.downloads} + 1`, updatedAt: new Date() })
          .where(eq(a2aAgents.id, row.id))

        // 同 MCP：装完即可调用，记一条安装。
        await recordAssetInstall({
          userId: authResult.userId,
          assetType: 'a2a',
          assetId: row.id,
          assetName: row.agentName,
          source: 'install',
        })

        return textResult({
          kind: 'a2a',
          id: row.id,
          slug: row.slug,
          runtime,
          gatewayUrl: buildA2aGatewayUrl(row.agentName),
          agentCardUrl: buildA2aAgentCardUrl(row.agentName),
          agentName: row.agentName,
          authHeader: `Authorization: Bearer ${API_KEY_PLACEHOLDER}`,
          apiKeysPath: API_KEYS_PATH,
          // 同 MCP：按次付费没有"已购买"状态，要说清调用时才扣费。
          billing:
            a2aEntitlement.reason === 'metered'
              ? 'metered：安装不收费，每次调用按量从账户余额扣除'
              : undefined,
          note: '仅平台网关 Agent Card / invoke；禁止 Provider 直连。',
        })
      }

      return textResult({ error: `不支持的 kind: ${kind}` }, true)
    }

    default:
      return textResult({ error: `未知工具: ${name}` }, true)
  }
}

export function storeServerInfo() {
  const base = getAppBaseUrl()
  return {
    name: 'openmcp-store',
    version: '1.0.0',
    description: 'OpenMCP Hub marketplace Store MCP — search / recommend / get / install published assets',
    url: buildStoreMcpUrl(base),
    oauth: {
      deviceCodeUrl: `${base}/api/mcp/store/oauth/device`,
      tokenUrl: `${base}/api/mcp/store/oauth/token`,
      authorizeUrl: `${base}/api/mcp/store/oauth/authorize`,
      verificationUri: `${base}/device`,
      note: 'authMode/deviceCodeUrl/tokenUrl are agent-readable hints; Cursor does not auto-poll. Prefer API Key headers for simple setups.',
    },
    tools: STORE_MCP_TOOLS.map((t) => t.name),
  }
}
