export const SCAN_RULES_VERSION = 'v1.0.0'

export type SecurityGrade = 'safe' | 'caution' | 'unsafe' | 'reject' | 'unknown'
export type FlagSeverity = 'critical' | 'high' | 'medium' | 'low'
export type TrustTier = 1 | 2 | 3 | 4 | 5

export interface SecurityFlagHit {
  name: string
  severity: FlagSeverity
  description: string
  file?: string
  line?: number
  snippet?: string
  inCodeBlock?: boolean
  citedOrNegated?: boolean
}

export interface LlmAnalysis {
  grade: SecurityGrade
  confidence: number
  riskSummary: string
  findings: Array<{ severity: string; description: string; mitigation: string }>
  recommendation: string
}

export interface ScanFileInput {
  path: string
  content: string
}

export interface RuleScanResult {
  grade: SecurityGrade
  flags: SecurityFlagHit[]
  trustTier: TrustTier
  fileCount: number
}

export interface ScanResult {
  grade: SecurityGrade
  flags: SecurityFlagHit[]
  trustTier: TrustTier
  llmGrade?: SecurityGrade
  llmAnalysis?: LlmAnalysis
  scannedAt: string
  rulesVersion: string
  fileCount: number
}

export interface ScanContext {
  owner?: string | null
  homepage?: string | null
  stars?: number | null
  license?: string | null
}
