import { eq } from 'drizzle-orm'
import { db } from "@/lib/db"
import { skillReviews, skillScans, skills } from "@workspace/db"
import { notifyAdmins } from "@/lib/notifications"
import { analyzeWithLlm } from '@workspace/security-scan'
import { SCAN_RULES_VERSION } from '@workspace/security-scan'
import { scanFiles } from '@workspace/security-scan'
import type { ScanContext, ScanFileInput, ScanResult, SecurityGrade } from '@workspace/security-scan'
import { scanSkillOnConsole } from '@/lib/console/client'
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
  const result: ScanResult = {
    grade,
    flags: rule.flags,
    trustTier: rule.trustTier,
    llmGrade,
    llmAnalysis,
    scannedAt: new Date().toISOString(),
    rulesVersion: SCAN_RULES_VERSION,
    fileCount: rule.fileCount,
  }

  await persistSkillScanResult(input.skillId, result)
  return result
}

/**
 * 把一份扫描结论落库并执行门控，不做任何扫描本身。
 *
 * 两条路径的**结论来源**不同（本地算的 / console 算的），但**门控语义必须完全一
 * 致**：ZIP 导入 caution 自动上架、GitHub 导入 caution 进人工，这种偏差会让两个入口
 * 长期行为不一致。所以落库 + 写 `skill_scans` / `skill_reviews` + 通知 + 触发 eval
 * report 全收在这里，扫描方只负责交回 `ScanResult`。
 */
export async function persistSkillScanResult(skillId: string, result: ScanResult): Promise<ScanResult> {
  const grade = result.grade
  const llmGrade = result.llmGrade
  const llmAnalysis = result.llmAnalysis
  const scannedAt = new Date(result.scannedAt)

  const nextStatus = statusFromGrade(grade)
  const [existing] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
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
      scanRulesVersion: result.rulesVersion,
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
    .where(eq(skills.id, skillId))

  await db.insert(skillScans).values({
    skillId,
    grade,
    llmGrade: llmGrade ?? null,
    flags: result.flags,
    llmAnalysis: llmAnalysis ?? null,
    trustTier: result.trustTier,
    rulesVersion: result.rulesVersion,
    fileCount: result.fileCount,
  })

  if (nextStatus === 'pending_review') {
    await db.insert(skillReviews).values({
      skillId,
      reviewType: 'manual',
      scanRulesVersion: result.rulesVersion,
      scanGrade: grade,
      llmGrade: llmGrade ?? null,
      flaggedFlags: result.flags,
    })
    await notifyAdmins({
      type: 'skill_pending_review',
      title: `Skill 进入人工复核：${existing.title}`,
      body: `Skill ${existing.title} 扫描评级为 ${grade}，请尽快审核。`,
      metadata: { skillId, grade },
    })
  }

  if (grade === 'reject') {
    await db.insert(skillReviews).values({
      skillId,
      reviewType: 'auto_reject',
      decision: 'reject',
      reviewComment: result.flags.map((f) => `${f.name}: ${f.description}`).join('\n'),
      scanRulesVersion: result.rulesVersion,
      scanGrade: grade,
      llmGrade: llmGrade ?? null,
      flaggedFlags: result.flags,
    })
  }

  await computeAndPersistEvalReport(skillId).catch((err: unknown) => {
    console.error('[security-scan] evalReport persist failed', skillId, err)
  })

  return result
}

/**
 * 让 console 对仓库跑扫描并落库。
 *
 * 请求只带地址不带文件：console 自己取源码，同一个提交在每次扫描里得到同一个结
 * 论。失败时**不**把技能判死——抛出的错误由调用方记录，技能行保持
 * `status: "scanning"` + `securityGrade: "unknown"`，理由与上架策略一致：未完成
 * 扫描不可上架，但扫描器抖一下不该把用户的提交变成 `rejected`。
 */
export async function runRemoteSkillSecurityScan(input: {
  skillId: string
  repoFullName: string
  ref?: string
  skillDir?: string
  includeLlm?: boolean
}): Promise<ScanResult> {
  const response = await scanSkillOnConsole({
    repoFullName: input.repoFullName,
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.skillDir ? { skillDir: input.skillDir } : {}),
    ...(input.includeLlm != null ? { includeLlm: input.includeLlm } : {}),
  })
  const result: ScanResult = {
    grade: response.grade,
    flags: response.flags,
    trustTier: response.trustTier,
    ...(response.llmGrade ? { llmGrade: response.llmGrade } : {}),
    ...(response.llmAnalysis ? { llmAnalysis: response.llmAnalysis } : {}),
    scannedAt: response.scannedAt,
    rulesVersion: response.rulesVersion,
    fileCount: response.fileCount,
  }
  return persistSkillScanResult(input.skillId, result)
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
