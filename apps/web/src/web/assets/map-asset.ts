import { format } from 'date-fns'
import type { MyAsset, MyAssetStatus, ScanResult, SkillAsset } from "@/components/assets/assets-data"
import { fromDbAuth, fromDbTransport } from "@/lib/gateway/types"

function fmt(date: Date | null | undefined): string {
  if (!date) return ''
  return format(date, 'yyyy-MM-dd HH:mm')
}

function mcpLifecycle(row: { status: string; connectionStatus: string | null }): MyAssetStatus {
  if (row.connectionStatus === 'disabled') return 'disabled'
  if (row.connectionStatus === 'error') return 'abnormal'
  if (row.status === 'published') return 'published'
  if (row.status === 'rejected') return 'rejected'
  if (row.status === 'submitted') return 'reviewing'
  return 'online'
}

function skillLifecycle(row: { status: string; securityGrade: string | null }): MyAssetStatus {
  if (row.status === 'scanning') return 'abnormal'
  if (row.status === 'pending_review' || row.securityGrade === 'unsafe') return 'abnormal'
  if (row.status === 'needs_revision') return 'abnormal'
  if (row.status === 'rejected') return 'rejected'
  if (row.status === 'published') return row.securityGrade === 'caution' ? 'published' : 'published'
  if (row.status === 'archived') return 'disabled'
  return 'online'
}

export function mapMcpRow(row: {
  id: string
  name: string
  slug: string
  description: string | null
  endpoint: string | null
  transport: 'http' | 'sse' | 'stdio'
  authType: string | null
  status: string
  connectionStatus: string | null
  scope: 'public' | 'private' | 'team'
  priceType: 'free' | 'paid'
  billingModel: 'one_time' | 'subscription' | 'pay_per_call' | null
  priceAmount: string | null
  unitPrice: string | null
  currency: string | null
  tools: unknown
  lastTestedAt: Date | null
  createdAt: Date
  updatedAt: Date
  rejectReason?: string | null
}): MyAsset {
  const tools = Array.isArray(row.tools) ? row.tools : []
  const toolNames = tools
    .map((t) => (t && typeof t === 'object' && 'name' in t ? String((t as { name: unknown }).name) : ''))
    .filter(Boolean)
  return {
    id: row.id,
    type: 'mcp',
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    endpoint: row.endpoint,
    protocol: fromDbTransport(row.transport),
    auth: fromDbAuth(row.authType),
    status: mcpLifecycle(row),
    visibility: row.scope,
    price: {
      type: row.priceType,
      model: row.billingModel,
      amount: row.priceAmount,
      unitPrice: row.unitPrice,
      currency: row.currency ?? 'CNY',
    },
    tools: toolNames.length,
    toolNames,
    lastTestedAt: fmt(row.lastTestedAt),
    rejectReason: row.rejectReason ?? null,
    createdAt: fmt(row.createdAt),
    updatedAt: fmt(row.updatedAt),
  }
}

export function mapA2aRow(row: {
  id: string
  name: string
  slug: string
  description: string | null
  endpoint: string | null
  agentCardUrl: string | null
  protocolVersion: string | null
  authType: string | null
  status: string
  connectionStatus: string | null
  visibility: 'public' | 'private' | 'team' | null
  priceType: 'free' | 'paid'
  billingModel: 'one_time' | 'subscription' | 'pay_per_call' | null
  priceAmount: string | null
  unitPrice: string | null
  currency: string | null
  agentCard: unknown
  lastTestedAt: Date | null
  createdAt: Date
  updatedAt: Date
  rejectReason?: string | null
}): MyAsset {
  const card = (row.agentCard ?? {}) as { skills?: Array<{ name?: string }> }
  const toolNames = Array.isArray(card.skills) ? card.skills.map((s) => s.name ?? '').filter(Boolean) : []
  return {
    id: row.id,
    type: 'a2a',
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    endpoint: row.endpoint ?? row.agentCardUrl,
    protocol: row.protocolVersion ?? '1.0',
    auth: fromDbAuth(row.authType),
    status: mcpLifecycle(row),
    visibility: row.visibility ?? 'public',
    price: {
      type: row.priceType,
      model: row.billingModel,
      amount: row.priceAmount,
      unitPrice: row.unitPrice,
      currency: row.currency ?? 'CNY',
    },
    tools: toolNames.length,
    toolNames,
    lastTestedAt: fmt(row.lastTestedAt),
    rejectReason: row.rejectReason ?? null,
    createdAt: fmt(row.createdAt),
    updatedAt: fmt(row.updatedAt),
  }
}

export function mapSkillRow(row: {
  id: string
  title: string
  slug: string
  description: string | null
  status: string
  securityGrade: string | null
  visibility: 'public' | 'private' | 'team' | null
  priceType: 'free' | 'paid'
  billingModel: 'one_time' | 'subscription' | 'pay_per_call' | null
  priceAmount: string | null
  unitPrice: string | null
  currency: string | null
  sourceType: 'github' | 'zip' | null
  githubUrl: string | null
  scannedAt: Date | null
  createdAt: Date
  updatedAt: Date
  reviewComment: string | null
  securityFlags: unknown
  securityLlmGrade: string | null
  securityLlmAnalysis: unknown
  trustTier: number | null
  scanRulesVersion: string | null
  metadata: unknown
}): SkillAsset {
  const meta = (row.metadata ?? {}) as { tools?: string[] }
  const toolNames = Array.isArray(meta.tools) ? meta.tools.map(String) : []
  let scanResult: ScanResult | null = null
  if (row.securityGrade && row.securityGrade !== 'unknown') {
    scanResult = {
      grade: row.securityGrade as ScanResult['grade'],
      flags: Array.isArray(row.securityFlags) ? (row.securityFlags as ScanResult['flags']) : [],
      trustTier: (row.trustTier as ScanResult['trustTier']) || 5,
      llmGrade: (row.securityLlmGrade as ScanResult['llmGrade']) ?? undefined,
      llmAnalysis: (row.securityLlmAnalysis as ScanResult['llmAnalysis']) ?? undefined,
      scannedAt: fmt(row.scannedAt),
      rulesVersion: row.scanRulesVersion ?? 'v1.0.0',
      fileCount: (() => {
        const m = (row.metadata ?? {}) as any
        if (m && Array.isArray(m.sourceFiles)) return m.sourceFiles.length
        const sf = (row as any).skillScans
        if (Array.isArray(sf) && sf.length > 0 && typeof sf[0].fileCount === 'number') return sf[0].fileCount
        if (Array.isArray(row.securityFlags)) return row.securityFlags.length
        return 0
      })(),
    }
  }
  return {
    id: row.id,
    type: 'skills',
    name: row.title,
    slug: row.slug,
    description: row.description ?? '',
    endpoint: row.githubUrl,
    imageUrl: (row as { imageUrl?: string | null }).imageUrl ?? null,
    protocol: 'openai',
    auth: 'none',
    status: skillLifecycle(row),
    visibility: row.visibility ?? 'public',
    price: {
      type: row.priceType,
      model: row.billingModel,
      amount: row.priceAmount,
      unitPrice: row.unitPrice,
      currency: row.currency ?? 'CNY',
    },
    tools: toolNames.length,
    toolNames,
    lastTestedAt: fmt(row.scannedAt),
    rejectReason: row.reviewComment,
    createdAt: fmt(row.createdAt),
    updatedAt: fmt(row.updatedAt),
    source: row.sourceType ?? 'github',
    repoUrl: row.githubUrl,
    scanResult,
  }
}
