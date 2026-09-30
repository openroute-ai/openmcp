import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { a2aAgents, mcpServers, skills } from '@workspace/db'
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
import { authors } from '@workspace/db'
import type { StoreAuthResult } from './auth'
import { createDeviceCode } from './oauth'

export const STORE_MCP_TOOLS = [
  {
    name: 'search_assets',
    description:
      'Search published OpenMCP marketplace assets (skills, MCP servers, A2A agents). Anonymous OK.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (title/name/slug/description)' },
        kind: {
          type: 'string',
          enum: ['skill', 'mcp', 'a2a'],
          description: 'Optional asset kind filter',
        },
        limit: { type: 'number', description: 'Max results (1-50, default 10)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_asset',
    description: 'Get published asset detail + install metadata by id or slug. Anonymous OK.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['skill', 'mcp', 'a2a'] },
        id: { type: 'string', description: 'Asset uuid or slug' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'install_asset',
    description:
      'Install a published asset for a runtime. Requires auth (API Key or OAuth). Paid skills need entitlement.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['skill', 'mcp', 'a2a'] },
        id: { type: 'string', description: 'Asset uuid or slug' },
        runtime: {
          type: 'string',
          enum: ['cursor', 'claude-code', 'codex', 'generic-prompt'],
          description: 'Target agent runtime (default: cursor)',
        },
        version: { type: 'string', description: 'Optional skill version' },
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

async function searchSkills(q: string, limit: number) {
  const pattern = `%${q}%`
  const rows = await db
    .select({
      id: skills.id,
      slug: skills.slug,
      title: skills.title,
      description: skills.description,
      version: skills.version,
      priceType: skills.priceType,
      priceAmount: skills.priceAmount,
      securityGrade: skills.securityGrade,
      certified: skills.certified,
      downloads: skills.downloads,
    })
    .from(skills)
    .where(
      and(
        eq(skills.status, 'published'),
        or(
          ilike(skills.title, pattern),
          ilike(skills.slug, pattern),
          ilike(skills.description, pattern),
          ilike(skills.titleEn, pattern)
        )
      )
    )
    .orderBy(desc(skills.downloads), desc(skills.publishedAt))
    .limit(limit)

  return rows.map((r) => ({
    kind: 'skill' as const,
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    version: r.version,
    priceType: r.priceType,
    priceAmount: r.priceAmount,
    securityGrade: r.securityGrade,
    certified: r.certified,
    downloads: r.downloads,
    detailUrl: buildAssetDetailUrl('skill', r.slug),
  }))
}

async function searchMcp(q: string, limit: number) {
  const pattern = `%${q}%`
  const rows = await db
    .select({
      id: mcpServers.id,
      slug: mcpServers.slug,
      name: mcpServers.name,
      description: mcpServers.description,
      priceType: mcpServers.priceType,
      unitPrice: mcpServers.unitPrice,
      certified: mcpServers.certified,
      securityLevel: mcpServers.securityLevel,
      serverName: mcpServers.serverName,
      downloads: mcpServers.downloads,
    })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.status, 'published'),
        or(
          ilike(mcpServers.name, pattern),
          ilike(mcpServers.slug, pattern),
          ilike(mcpServers.description, pattern),
          ilike(mcpServers.serverName, pattern)
        )
      )
    )
    .orderBy(desc(mcpServers.downloads), desc(mcpServers.publishedAt))
    .limit(limit)

  return rows.map((r) => ({
    kind: 'mcp' as const,
    id: r.id,
    slug: r.slug,
    title: r.name,
    description: r.description,
    priceType: r.priceType,
    unitPrice: r.unitPrice,
    certified: r.certified,
    securityLevel: r.securityLevel,
    serverName: r.serverName,
    downloads: r.downloads,
    detailUrl: buildAssetDetailUrl('mcp', r.slug),
    gatewayUrl: r.serverName ? buildMcpGatewayUrl(r.serverName) : null,
  }))
}

async function searchA2a(q: string, limit: number) {
  const pattern = `%${q}%`
  const rows = await db
    .select({
      id: a2aAgents.id,
      slug: a2aAgents.slug,
      name: a2aAgents.name,
      description: a2aAgents.description,
      priceType: a2aAgents.priceType,
      unitPrice: a2aAgents.unitPrice,
      certified: a2aAgents.certified,
      securityLevel: a2aAgents.securityLevel,
      agentName: a2aAgents.agentName,
      downloads: a2aAgents.downloads,
    })
    .from(a2aAgents)
    .where(
      and(
        eq(a2aAgents.status, 'published'),
        or(
          ilike(a2aAgents.name, pattern),
          ilike(a2aAgents.slug, pattern),
          ilike(a2aAgents.description, pattern),
          ilike(a2aAgents.agentName, pattern)
        )
      )
    )
    .orderBy(desc(a2aAgents.downloads), desc(a2aAgents.publishedAt))
    .limit(limit)

  return rows.map((r) => ({
    kind: 'a2a' as const,
    id: r.id,
    slug: r.slug,
    title: r.name,
    description: r.description,
    priceType: r.priceType,
    unitPrice: r.unitPrice,
    certified: r.certified,
    securityLevel: r.securityLevel,
    agentName: r.agentName,
    downloads: r.downloads,
    detailUrl: buildAssetDetailUrl('a2a', r.slug),
    gatewayUrl: r.agentName ? buildA2aGatewayUrl(r.agentName) : null,
    agentCardUrl: r.agentName ? buildA2aAgentCardUrl(r.agentName) : null,
  }))
}

async function resolveSkill(idOrSlug: string) {
  const byId = await db.select().from(skills).where(eq(skills.id, idOrSlug)).limit(1)
  if (byId[0]) return byId[0]
  const bySlug = await db.select().from(skills).where(eq(skills.slug, idOrSlug)).limit(1)
  return bySlug[0] ?? null
}

async function resolveMcp(idOrSlug: string) {
  const byId = await db.select().from(mcpServers).where(eq(mcpServers.id, idOrSlug)).limit(1)
  if (byId[0]) return byId[0]
  const bySlug = await db.select().from(mcpServers).where(eq(mcpServers.slug, idOrSlug)).limit(1)
  return bySlug[0] ?? null
}

async function resolveA2a(idOrSlug: string) {
  const byId = await db.select().from(a2aAgents).where(eq(a2aAgents.id, idOrSlug)).limit(1)
  if (byId[0]) return byId[0]
  const bySlug = await db.select().from(a2aAgents).where(eq(a2aAgents.slug, idOrSlug)).limit(1)
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
      const q = String(args.q ?? '').trim()
      if (!q) return textResult({ error: '缺少参数 q' }, true)
      const kind = args.kind as AssetKind | undefined
      const limit = clampLimit(args.limit)

      if (kind === 'skill') return textResult({ assets: await searchSkills(q, limit) })
      if (kind === 'mcp') return textResult({ assets: await searchMcp(q, limit) })
      if (kind === 'a2a') return textResult({ assets: await searchA2a(q, limit) })

      const per = Math.max(1, Math.ceil(limit / 3))
      const [skillRows, mcpRows, a2aRows] = await Promise.all([
        searchSkills(q, per),
        searchMcp(q, per),
        searchA2a(q, per),
      ])
      return textResult({ assets: [...skillRows, ...mcpRows, ...a2aRows].slice(0, limit) })
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
          certified: row.certified,
          serverName: row.serverName,
          detailUrl: buildAssetDetailUrl('mcp', row.slug),
          gatewayUrl: row.serverName ? buildMcpGatewayUrl(row.serverName) : null,
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
          certified: row.certified,
          agentName: row.agentName,
          detailUrl: buildAssetDetailUrl('a2a', row.slug),
          gatewayUrl: row.agentName ? buildA2aGatewayUrl(row.agentName) : null,
          agentCardUrl: row.agentName ? buildA2aAgentCardUrl(row.agentName) : null,
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
        await db
          .update(a2aAgents)
          .set({ downloads: sql`${a2aAgents.downloads} + 1`, updatedAt: new Date() })
          .where(eq(a2aAgents.id, row.id))

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
    description: 'OpenMCP marketplace Store MCP — search / get / install published assets',
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
