import { eq } from 'drizzle-orm'
import { db } from "@/lib/db"
import { skillReviews, skillScans, skills } from "@workspace/db"
import { notifyAdmins } from "@/lib/notifications"
import { analyzeWithLlm } from '@workspace/security-scan'
import { SCAN_RULES_VERSION } from '@workspace/security-scan'
import { scanFiles } from '@workspace/security-scan'
import type { ScanContext, ScanFileInput, ScanResult, SecurityGrade } from '@workspace/security-scan'
import { computeAndPersistEvalReport } from "@/lib/skills/eval-report-persist"

const MAX_FILE_BYTES = Number(process.env.SCAN_FILE_MAX_SIZE || 5 * 1024 * 1024)

function truncate(content: string): string {
  if (content.length <= MAX_FILE_BYTES) return content
  return content.slice(0, MAX_FILE_BYTES)
}

function mergeGrade(rule: SecurityGrade, llm: SecurityGrade | null): SecurityGrade {
  if (rule === 'reject') return 'reject'
  if (!llm) return rule === 'unsafe' || rule === 'caution' ? 'caution' : rule
  if (llm === 'safe') return 'safe'
  return llm
}

/** Grades that auto-publish after scan. Env comma-list, default `safe`. */
export function getAutoPublishGrades(): Set<SecurityGrade> {
  const raw = process.env.SKILLS_AUTO_PUBLISH_GRADES
  const list = (raw == null || raw.trim() === '' ? 'safe' : raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as SecurityGrade[]
  return new Set(list)
}

function statusFromGrade(grade: SecurityGrade): typeof skills.$inferInsert.status {
  // Hard rules
  if (grade === 'reject') return 'rejected'
  if (grade === 'unsafe') return 'pending_review'
  // Configurable auto-publish set (default: safe only). caution → pending_review unless listed.
  if (getAutoPublishGrades().has(grade)) return 'published'
  if (grade === 'safe' || grade === 'caution') return 'pending_review'
  return 'draft'
}

export async function runSkillSecurityScan(input: {
  skillId: string
  files: ScanFileInput[]
  context?: ScanContext
}): Promise<ScanResult> {
  const files = input.files.map((f) => ({ ...f, content: truncate(f.content) }))
  const rule = scanFiles(files, input.context ?? {})

  let llmGrade: SecurityGrade | undefined
  let llmAnalysis: ScanResult['llmAnalysis']
  if (rule.grade === 'caution' || rule.grade === 'unsafe') {
    const llm = await analyzeWithLlm(files, rule.flags, rule.grade)
    if (llm) {
      llmGrade = llm.grade
      llmAnalysis = llm
    } else {
      llmAnalysis = {
        grade: 'caution',
        confidence: 0,
        riskSummary: 'LLM review failed; manual review recommended.',
        findings: [],
        recommendation: 'Manual review recommended',
      }
    }
  }

  const grade = mergeGrade(rule.grade, llmGrade ?? null)
  const scannedAt = new Date()
  const result: ScanResult = {
    grade,
    flags: rule.flags,
    trustTier: rule.trustTier,
    llmGrade,
    llmAnalysis,
    scannedAt: scannedAt.toISOString(),
    rulesVersion: SCAN_RULES_VERSION,
    fileCount: rule.fileCount,
  }

  const nextStatus = statusFromGrade(grade)
  const [existing] = await db.select().from(skills).where(eq(skills.id, input.skillId)).limit(1)
  if (!existing) return result

  await db
    .update(skills)
    .set({
      securityGrade: grade,
      securityFlags: result.flags,
      securityLlmGrade: llmGrade ?? null,
      securityLlmAnalysis: llmAnalysis ?? null,
      trustTier: result.trustTier,
      scannedAt,
      scanRulesVersion: SCAN_RULES_VERSION,
      securityLevel: grade,
      status: nextStatus,
      publishedAt: nextStatus === 'published' ? (existing.publishedAt ?? scannedAt) : existing.publishedAt,
      reviewStatus:
        nextStatus === 'pending_review'
          ? 'pending_review'
          : grade === 'reject'
            ? 'rejected'
            : existing.reviewStatus,
      reviewComment: grade === 'reject' ? result.flags.map((f) => f.name).join(', ') : existing.reviewComment,
      updatedAt: scannedAt,
    })
    .where(eq(skills.id, input.skillId))

  await db.insert(skillScans).values({
    skillId: input.skillId,
    grade,
    llmGrade: llmGrade ?? null,
    flags: result.flags,
    llmAnalysis: llmAnalysis ?? null,
    trustTier: result.trustTier,
    rulesVersion: SCAN_RULES_VERSION,
    fileCount: result.fileCount,
  })

  if (nextStatus === 'pending_review') {
    await db.insert(skillReviews).values({
      skillId: input.skillId,
      reviewType: 'manual',
      scanRulesVersion: SCAN_RULES_VERSION,
      scanGrade: grade,
      llmGrade: llmGrade ?? null,
      flaggedFlags: result.flags,
    })
    await notifyAdmins({
      type: 'skill_pending_review',
      title: `Skill 进入人工复核：${existing.title}`,
      body: `Skill ${existing.title} 扫描评级为 ${grade}，请尽快审核。`,
      metadata: { skillId: input.skillId, grade },
    })
  }

  if (grade === 'reject') {
    await db.insert(skillReviews).values({
      skillId: input.skillId,
      reviewType: 'auto_reject',
      decision: 'reject',
      reviewComment: result.flags.map((f) => `${f.name}: ${f.description}`).join('\n'),
      scanRulesVersion: SCAN_RULES_VERSION,
      scanGrade: grade,
      llmGrade: llmGrade ?? null,
      flaggedFlags: result.flags,
    })
  }

  await computeAndPersistEvalReport(input.skillId).catch((err: unknown) => {
    console.error('[security-scan] evalReport persist failed', input.skillId, err)
  })

  return result
}

export async function filesFromSkillRow(skill: {
  readme: string | null
  readmeEn: string | null
  metadata: unknown
}): Promise<ScanFileInput[]> {
  const files: ScanFileInput[] = []
  if (skill.readme) files.push({ path: 'README.md', content: skill.readme })
  if (skill.readmeEn) files.push({ path: 'README.en.md', content: skill.readmeEn })
  const meta = (skill.metadata ?? {}) as Record<string, unknown>
  if (typeof meta.skillYaml === 'string') files.push({ path: 'skill.yaml', content: meta.skillYaml })
  if (Array.isArray(meta.sourceFiles)) {
    for (const item of meta.sourceFiles) {
      if (item && typeof item === 'object' && 'path' in item && "content" in item) {
        files.push({ path: String((item as { path: unknown }).path), content: String((item as { content: unknown }).content) })
      }
    }
  }
  return files
}
