/** Client-safe OpenMCP Eval heuristics — no DB / Node-only imports. */

export const OPENMCP_EVAL_PROFILE = 'openmcp-eval-v1' as const

export const OPENMCP_EVAL_WEIGHTS = {
  trust: 0.3,
  reliability: 0.15,
  adaptability: 0.15,
  convention: 0.15,
  effectiveness: 0.25,
} as const

export type OpenmcpEvalDimensions = {
  trust: number
  reliability: number
  adaptability: number
  convention: number
  effectiveness: number
}

export type OpenmcpEvalReportV1 = {
  profile: typeof OPENMCP_EVAL_PROFILE
  version: typeof OPENMCP_EVAL_PROFILE
  overall: number
  dimensions: OpenmcpEvalDimensions
  weights: typeof OPENMCP_EVAL_WEIGHTS
  reasons?: Partial<Record<keyof OpenmcpEvalDimensions, { zh: string; en: string }>>
  updatedAt: string
  source: 'heuristic' | 'llm' | 'manual'
}

export function clampScore(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10))
}

export function trustFromGate(grade: string | null | undefined, certified: boolean): number {
  const g = grade ?? 'unknown'
  let base = 1.5
  switch (g) {
    case 'safe':
      base = 4
      break
    case 'caution':
      base = 2.8
      break
    case 'unsafe':
      base = 1.5
      break
    case 'reject':
      base = 0.8
      break
    default:
      base = 1.5
  }
  if (certified && (g === 'safe' || g === 'caution')) base = Math.min(5, base + 0.8)
  return clampScore(base)
}

export function computeOpenmcpEvalV1(input: {
  securityGrade: string | null | undefined
  certified: boolean
  features: string[] | null | undefined
  scenario: string | null | undefined
  version: string | null | undefined
  platforms: unknown
  readme: string | null | undefined
  downloads: number
}): OpenmcpEvalReportV1 {
  const trust = trustFromGate(input.securityGrade, input.certified)
  const featureCount = Array.isArray(input.features) ? input.features.length : 0
  const platformCount = Array.isArray(input.platforms) ? input.platforms.length : 0
  const readmeLen = input.readme?.length ?? 0
  const hasScenario = Boolean(input.scenario && input.scenario.trim().length > 20)
  const hasVersion = Boolean(input.version)

  const reliability = clampScore(
    (readmeLen > 800 ? 4.2 : readmeLen > 200 ? 3.2 : readmeLen > 0 ? 2.2 : 1.2) + (hasVersion ? 0.5 : 0)
  )
  const adaptability = clampScore(1.5 + Math.min(2.5, platformCount * 0.7) + (hasScenario ? 0.8 : 0))
  const convention = clampScore(1.8 + Math.min(2.2, featureCount * 0.35) + (hasVersion ? 0.4 : 0))
  const effectiveness = clampScore(
    (hasScenario ? 3.2 : 1.8) +
      Math.min(1.5, Math.log10(Math.max(1, input.downloads + 1))) +
      (featureCount > 0 ? 0.4 : 0)
  )

  const dimensions: OpenmcpEvalDimensions = {
    trust,
    reliability,
    adaptability,
    convention,
    effectiveness,
  }

  const overall = clampScore(
    dimensions.trust * OPENMCP_EVAL_WEIGHTS.trust +
      dimensions.reliability * OPENMCP_EVAL_WEIGHTS.reliability +
      dimensions.adaptability * OPENMCP_EVAL_WEIGHTS.adaptability +
      dimensions.convention * OPENMCP_EVAL_WEIGHTS.convention +
      dimensions.effectiveness * OPENMCP_EVAL_WEIGHTS.effectiveness
  )

  return {
    profile: OPENMCP_EVAL_PROFILE,
    version: OPENMCP_EVAL_PROFILE,
    overall,
    dimensions,
    weights: { ...OPENMCP_EVAL_WEIGHTS },
    updatedAt: new Date().toISOString(),
    source: 'heuristic',
  }
}

export function parseEvalReport(metadata: unknown): OpenmcpEvalReportV1 | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>).evalReport
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const dims = r.dimensions
  if (!dims || typeof dims !== 'object') return null
  const d = dims as Record<string, unknown>
  if (typeof d.trust !== 'number' || typeof r.overall !== 'number') return null
  return {
    profile: OPENMCP_EVAL_PROFILE,
    version: typeof r.version === 'string' ? (r.version as typeof OPENMCP_EVAL_PROFILE) : OPENMCP_EVAL_PROFILE,
    overall: clampScore(r.overall),
    dimensions: {
      trust: clampScore(Number(d.trust)),
      reliability: clampScore(Number(d.reliability)),
      adaptability: clampScore(Number(d.adaptability)),
      convention: clampScore(Number(d.convention)),
      effectiveness: clampScore(Number(d.effectiveness)),
    },
    weights: { ...OPENMCP_EVAL_WEIGHTS },
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
    source: r.source === 'llm' || r.source === 'manual' ? r.source : 'heuristic',
  }
}

export function gradePillFromScore(score: number, locale: 'zh' | 'en'): string {
  if (score >= 4.5) return locale === 'zh' ? '优秀' : 'Excellent'
  if (score >= 3.5) return locale === 'zh' ? '良好' : 'Good'
  if (score >= 2.5) return locale === 'zh' ? '一般' : 'Fair'
  return locale === 'zh' ? '待提升' : 'Needs work'
}
