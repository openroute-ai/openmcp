/**
 * Console「我的资产」的共享类型与常量。
 *
 * 这个文件曾住着一整套前端演示数据（3 组假资产数组、假扫描结果，以及
 * `buildMetrics` / `buildCallLogs` / `runSecurityScan` 等假实现）。真实链路早已
 * 取代它们——资产来自各 gateway 的 `listMine`，观测数据来自 `web/assets/usage`
 * 读真实账本，扫描结果来自 `lib/security-scan`——但文件本身还留着。
 *
 * 代价不只是体积：`buildMetrics` 用 `hash(id + status)` 生成的确定性假指标被直接
 * 渲染到 Provider 面板上，看起来与真实监控毫无区别。**这里不再放任何演示数据**，
 * 需要数据就接 API。
 *
 * 扫描相关类型（`SecurityGrade` / `ScanResult` / `LlmAnalysis` 等）在
 * `lib/security-scan/types.ts` 里有规范定义，本文件不重复声明。
 */

import type { SecurityFlagHit, SecurityGrade, TrustTier } from '@/lib/security-scan/types'

/** 规范类型在 lib/security-scan/types.ts，这里沿用旧名避免大面积改名。 */
export type SecurityFlag = SecurityFlagHit
export type { SecurityGrade, TrustTier }

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export type MyAssetType = 'mcp' | 'a2a' | 'skills'
export type MyAssetStatus = 'online' | 'reviewing' | 'published' | 'rejected' | 'disabled' | 'abnormal'
export type AssetVisibility = 'public' | 'private' | 'team'
export type BillingModel = 'one_time' | 'subscription' | 'pay_per_call'

export interface MyAssetPrice {
  type: 'free' | 'paid'
  model?: BillingModel | null
  amount?: string | null
  unitPrice?: string | null
  currency?: string
}

export interface MyAsset {
  id: string
  type: MyAssetType
  name: string
  slug: string
  description: string
  endpoint?: string | null
  protocol: string
  auth: string
  status: MyAssetStatus
  visibility: AssetVisibility
  price: MyAssetPrice
  category?: string | null
  imageUrl?: string | null
  tools?: number | null
  toolNames: string[]
  lastTestedAt?: string
  rejectReason?: string | null
  createdAt: string
  updatedAt: string
  views?: number | null
  downloads?: number | null
  estimatedEarnings?: number | null
}

export const TYPE_LABELS: Record<MyAssetType, string> = {
  mcp: 'mcp',
  a2a: 'a2a',
  skills: 'skills',
}

export const ALLOWED_PROTOCOLS: Record<MyAssetType, string[]> = {
  mcp: ['streamable', 'sse'],
  a2a: ['1.0', '0.3'],
  skills: ['openai'],
}

export const ALLOWED_AUTHS: Record<MyAssetType, string[]> = {
  mcp: ['none', 'bearer', 'api_key', 'basic', 'oauth_client', 'custom'],
  a2a: ['none', 'bearer', 'api_key', 'basic', 'oauth_client', 'custom'],
  skills: ['none', 'api_key', 'oauth_client', 'custom'],
}

export interface LlmAnalysis {
  grade: SecurityGrade
  confidence: number
  riskSummary: string
  findings: Array<{ severity: string; description: string; mitigation: string }>
  recommendation: string
}

export interface ScanResult {
  grade: SecurityGrade
  flags: SecurityFlag[]
  trustTier: TrustTier
  llmGrade?: SecurityGrade
  llmAnalysis?: LlmAnalysis
  scannedAt: string
  rulesVersion: string
  fileCount: number
}

export interface SkillAsset extends MyAsset {
  type: 'skills'
  source: 'github' | 'zip'
  repoUrl?: string | null
  scanResult?: ScanResult | null
}

export interface GradedTestStep {
  key: 'handshake' | 'auth' | 'tools' | 'protocol'
  label: string
  status: 'pending' | 'running' | 'pass' | 'fail'
  detail?: string
}

export interface GradedTestResult {
  steps: GradedTestStep[]
  ok: boolean
  toolCount?: number
  durationMs: number
}

export interface AutoDiscoverResult {
  ok: boolean
  name?: string
  description?: string
  protocol?: string
  auth?: string
  toolCount?: number
  toolNames?: string[]
  durationMs: number
}

export const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  1: 'Official Org',
  2: 'Known Security Team',
  3: 'High-Star + Licensed',
  4: 'Moderate Trust',
  5: 'Unknown Source',
}

export const SECURITY_GRADE_LABELS: Record<SecurityGrade, string> = {
  safe: 'Safe',
  caution: 'Caution',
  unsafe: 'Unsafe',
  reject: 'Reject',
  unknown: 'Unknown',
}
