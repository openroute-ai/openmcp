import type { SecurityFlagHit } from '@workspace/security-scan'

/**
 * Review record shape returned by `trpc.admin.securityReview`.
 *
 * `flags` and `analysis` arrive as `unknown` (jsonb columns) and are cast at the
 * router boundary; the helper below narrows them once so pages do not each
 * re-implement the check.
 */
export interface ReviewRecord {
  /** The `skill_reviews` row id. */
  id: string
  skillId: string
  reviewType: 'auto_reject' | 'manual'
  reviewerId: string | null
  reviewerName: string | null
  decision: 'pass' | 'reject' | 'needs_revision' | null
  reviewComment: string | null
  /** `skill_reviews.flagged_flags` jsonb. */
  flags: unknown
  scanRulesVersion: string | null
  scanGrade: string | null
  llmGrade: string | null
  durationMinutes: number | null
  createdAt: Date
  title: string
  slug: string
  sourceType: 'github' | 'zip' | null
  githubUrl: string | null
  securityGrade: string | null
  securityLlmGrade: string | null
  securityFlags: unknown
  securityLlmAnalysis: unknown
  trustTier: number | null
  scannedAt: Date | null
  reviewStatus: string | null
  authorId: string
  authorName: string
  authorUsername: string
  authorAvatar: string | null
  fileCount: number
  submittedAt: Date
  waitingMinutes: number
  /** Alias of `flags`, normalised by the router. */
  analysis: unknown
}

/** Narrow a jsonb `flags` column to the flag array the scanner produced. */
export function toFlags(value: unknown): SecurityFlagHit[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is SecurityFlagHit =>
      typeof item === 'object' && item !== null && typeof (item as { name?: unknown }).name === 'string'
  )
}

/** Format a wait duration compactly: `45m`, `3h 20m`, `2d 4h`. */
export function formatWaiting(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / (60 * 24))}d ${Math.floor((minutes % (60 * 24)) / 60)}h`
}
