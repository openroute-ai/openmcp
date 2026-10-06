import {
  HIGH_RISK_PATTERNS,
  MEDIUM_RISK_PATTERNS,
  PIPE_TO_SHELL_PATTERNS,
  PLACEHOLDER_SECRET_RE,
  REJECT_PATTERNS,
  SECRET_PATTERNS,
  TIER1_ORGS,
  TIER2_ORGS,
  TRUSTED_INSTALL_HOSTS,
  type PatternDef,
} from './patterns'
import type { RuleScanResult, ScanContext, ScanFileInput, SecurityFlagHit, SecurityGrade, TrustTier } from './types'

const FENCE_RE = /```[\s\S]*?```/g
const NEGATION_RE = /\b(never|do not|don't|dont|avoid|instead of|such as|e\.g\.|for example)\b/i

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

function snippetAround(content: string, index: number): string {
  const start = content.lastIndexOf('\n', index)
  const end = content.indexOf('\n', index)
  const line = content.slice(start + 1, end === -1 ? undefined : end).trim()
  return line.slice(0, 240)
}

function inCodeFence(content: string, index: number): boolean {
  const fences = [...content.matchAll(FENCE_RE)]
  return fences.some((m) => typeof m.index === 'number' && index >= m.index && index < m.index + m[0].length)
}

function citedOrNegated(content: string, index: number): boolean {
  const start = Math.max(0, index - 120)
  const window = content.slice(start, index + 80)
  return NEGATION_RE.test(window)
}

function looksLikeRealSecret(value: string): boolean {
  if (PLACEHOLDER_SECRET_RE.test(value)) return false
  const unique = new Set(value.replace(/[^A-Za-z0-9]/g, '')).size
  return unique >= 10
}

function extractHost(match: string): string | null {
  const url = match.match(/https?:\/\/([^/\s'"]+)/i)
  return url?.[1]?.toLowerCase() ?? null
}

function isTrustedHost(host: string | null, ctx: ScanContext): boolean {
  if (!host) return false
  if (TRUSTED_INSTALL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true
  if (ctx.owner && host.includes(ctx.owner.toLowerCase())) return true
  if (ctx.homepage) {
    try {
      const homepageHost = new URL(ctx.homepage).host.toLowerCase()
      if (host === homepageHost || host.endsWith(`.${homepageHost}`)) return true
    } catch {
      return false
    }
  }
  return false
}

export function computeTrustTier(ctx: ScanContext): TrustTier {
  const owner = (ctx.owner ?? '').toLowerCase()
  if (TIER1_ORGS.includes(owner)) return 1
  if (TIER2_ORGS.includes(owner)) return 2
  const stars = ctx.stars ?? 0
  const licensed = Boolean(ctx.license && ctx.license !== 'NOASSERTION')
  if (stars >= 1000 && licensed) return 3
  if (stars >= 100 && licensed) return 4
  return 5
}

function matchPattern(file: ScanFileInput, def: PatternDef, ctx: ScanContext): SecurityFlagHit[] {
  const hits: SecurityFlagHit[] = []
  const content = file.content
  const regex = new RegExp(def.regex.source, def.regex.flags.includes('g') ? def.regex.flags : `${def.regex.flags}g`)
  for (const match of content.matchAll(regex)) {
    const index = match.index ?? 0
    const fenced = inCodeFence(content, index)
    if (def.skipCodeBlock && fenced) continue
    const negated = citedOrNegated(content, index)
    if (negated) continue

    if (def.kind === 'secret' && !looksLikeRealSecret(match[0])) continue

    if (def.kind === 'pipe') {
      const host = extractHost(match[0])
      if (isTrustedHost(host, ctx)) continue
    }

    hits.push({
      name: def.name,
      severity: def.severity,
      description: def.description,
      file: file.path,
      line: lineNumberAt(content, index),
      snippet: snippetAround(content, index),
      inCodeBlock: fenced,
      citedOrNegated: negated,
    })
  }
  return hits
}

function gradeFromFlags(flags: SecurityFlagHit[], trustTier: TrustTier): SecurityGrade {
  const rejectHits = flags.filter((f) => f.severity === 'critical')
  if (rejectHits.length > 0) return 'reject'

  const high = flags.filter((f) => f.severity === 'high')
  const medium = flags.filter((f) => f.severity === 'medium')

  if (high.length === 0) {
    if (medium.length >= 2 && trustTier >= 5) return 'caution'
    if (medium.length >= 2) return 'caution'
    return 'safe'
  }

  if (trustTier <= 3) return 'caution'
  if (trustTier === 4) return high.length > 1 ? 'unsafe' : 'caution'
  return 'unsafe'
}

export function scanFiles(files: ScanFileInput[], ctx: ScanContext = {}): RuleScanResult {
  const trustTier = computeTrustTier(ctx)
  const flags: SecurityFlagHit[] = []
  const all = [...REJECT_PATTERNS, ...HIGH_RISK_PATTERNS, ...MEDIUM_RISK_PATTERNS, ...PIPE_TO_SHELL_PATTERNS, ...SECRET_PATTERNS]

  for (const file of files) {
    for (const def of all) {
      flags.push(...matchPattern(file, def, ctx))
    }
  }

  const unique: SecurityFlagHit[] = []
  const seen = new Set<string>()
  for (const flag of flags) {
    const key = `${flag.name}:${flag.file}:${flag.line}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(flag)
  }

  return {
    grade: gradeFromFlags(unique, trustTier),
    flags: unique,
    trustTier,
    fileCount: files.length,
  }
}
