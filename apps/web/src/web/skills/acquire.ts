import { eq, sql } from 'drizzle-orm'
import { db } from "@/lib/db"
import { skillDownloads, skills, authors } from "@workspace/db"
import { filesFromSkillRow } from "@/lib/security-scan"
import { buildSkillPackage, buildMinimalSkillPackage } from '@/lib/agent-install/skill-package'
import { createZipStore } from "@/lib/zip/create-zip-store"
import { hasSkillEntitlement } from './purchase'
import { getVersionFiles, getSkillVersion } from './versions'

export type SkillAcquireDelivery =
  | {
      kind: 'github'
      githubUrl: string
      installNotes: string
      title: string
      version: string | null
      platforms: string[]
      installTips: string[]
      riskWarning: string | null
      downloads: number
      /** P1 Gap A: Minimal metadata package for GitHub skills */
      metaPackage?: { files: { path: string; content: string }[]; downloadUrl: string }
    }
  | {
      kind: 'files'
      files: { path: string; content: string }[]
      title: string
      version: string | null
      platforms: string[]
      installTips: string[]
      riskWarning: string | null
      downloads: number
      downloadUrl: string
    }

export type SkillAcquireResult =
  | { ok: true; delivery: SkillAcquireDelivery }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_PUBLISHED' | 'NEED_PURCHASE' | 'NO_CONTENT'; error: string }

function asPlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p) => String(p)).filter(Boolean)
}

function buildInstallTips(platforms: string[], locale: 'zh' | 'en'): string[] {
  const tipsZh: string[] = [
    '下载或克隆后，将 Skill 文件放到对应 Agent 平台的 skills 目录。',
    '首次使用前请阅读 README / SKILL.md 中的权限与安全说明。',
  ]
  const tipsEn: string[] = [
    'After download/clone, place Skill files into your Agent platform skills directory.',
    'Read README / SKILL.md for permissions and security notes before first use.',
  ]
  const tips = locale === 'zh' ? [...tipsZh] : [...tipsEn]
  const lower = platforms.map((p) => p.toLowerCase())
  if (lower.some((p) => p.includes('claude'))) {
    tips.push(locale === 'zh' ? 'Claude Code：可将 SKILL.md / CLAUDE.md 放入项目技能目录后重启会话。' : 'Claude Code: place SKILL.md / CLAUDE.md into the project skills dir, then restart.')
  }
  if (lower.some((p) => p.includes('codex'))) {
    tips.push(locale === 'zh' ? 'Codex：参考 .codex/skills 约定安装对应技能清单。' : 'Codex: follow .codex/skills conventions for install.')
  }
  if (lower.some((p) => p.includes('openclaw') || p.includes('opencode') || p === 'pi')) {
    tips.push(locale === 'zh' ? '按平台文档将技能包导入本地工作区即可调用。' : 'Import the skill package into your local workspace per platform docs.')
  }
  return tips
}

function extractRiskWarning(skill: {
  securityGrade: string | null
  securityLlmAnalysis: unknown
  securityFlags: unknown
}): string | null {
  if (skill.securityGrade !== 'caution') return null
  const analysis = skill.securityLlmAnalysis as { riskSummary?: string } | null
  if (analysis?.riskSummary) return analysis.riskSummary
  const flags = Array.isArray(skill.securityFlags) ? skill.securityFlags : []
  if (flags.length > 0) {
    return `该技能安全评级为 caution，存在 ${flags.length} 项风险标记，请谨慎使用。`
  }
  return '该技能安全评级为 caution，请阅读安全报告后谨慎使用。'
}


/** Entitlement check via skill_entitlements (Batch 2). */
export async function userHasSkillEntitlement(userId: string, skillId: string): Promise<boolean> {
  return hasSkillEntitlement(userId, skillId)
}

export async function acquireSkill(params: {
  skillId: string
  userId: string
  locale?: 'zh' | 'en'
  ipAddress?: string | null
  userAgent?: string | null
  /** When true, skip download counting (e.g. re-download zip after acquire). */
  skipCount?: boolean
  /** Optional: specific version to acquire (defaults to current version) */
  version?: string
}): Promise<SkillAcquireResult> {
  const locale = params.locale ?? 'zh'
  const [skill] = await db.select().from(skills).where(eq(skills.id, params.skillId)).limit(1)
  if (!skill) return { ok: false, code: 'NOT_FOUND', error: '技能未找到' }
  if (skill.status !== 'published') {
    return { ok: false, code: 'NOT_PUBLISHED', error: '技能未上架，无法获取' }
  }

  if (skill.priceType === 'paid') {
    const entitled = await userHasSkillEntitlement(params.userId, skill.id)
    if (!entitled) {
      return { ok: false, code: 'NEED_PURCHASE', error: '请先购买' }
    }
  }

  // Determine which version to use
  const targetVersion = params.version || skill.version || '1.0.0'
  let versionData = null
  
  // If a specific version is requested, validate and fetch it
  if (params.version) {
    versionData = await getSkillVersion({
      skillId: skill.id,
      version: params.version,
    })
    
    if (!versionData) {
      return { ok: false, code: 'NOT_FOUND', error: '指定的版本不存在' }
    }
    
    if (versionData.status !== 'published') {
      return { ok: false, code: 'NOT_PUBLISHED', error: '指定的版本未发布' }
    }
  }

  const platforms = asPlatforms(skill.platforms)
  const installTips = buildInstallTips(platforms, locale)
  const riskWarning = extractRiskWarning(skill)

  let downloads = skill.downloads
  if (!params.skipCount) {
    // P0: Record skill metadata for download history
    // Use upsert pattern: insert or update if user+skill already exists
    const existing = await db
      .select()
      .from(skillDownloads)
      .where(sql`${skillDownloads.userId} = ${params.userId} AND ${skillDownloads.skillId} = ${skill.id}`)
      .limit(1)

    if (existing.length > 0) {
      // Update existing record with the actual version being acquired
      await db
        .update(skillDownloads)
        .set({
          downloadedAt: new Date(),
          skillVersion: targetVersion,
          skillTitle: skill.title,
          skillSlug: skill.slug,
        })
        .where(sql`${skillDownloads.userId} = ${params.userId} AND ${skillDownloads.skillId} = ${skill.id}`)
    } else {
      // Insert new record with the actual version being acquired
      await db.insert(skillDownloads).values({
        skillId: skill.id,
        userId: params.userId,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        status: 'downloaded',
        skillVersion: targetVersion,
        skillTitle: skill.title,
        skillSlug: skill.slug,
      })
    }

    await db.update(skills).set({ downloads: sql`${skills.downloads} + 1`, updatedAt: new Date() }).where(eq(skills.id, skill.id))
    downloads = skill.downloads + 1
  }

  if (skill.sourceType === 'github' && skill.githubUrl) {
    // P1 Gap A: Generate minimal metadata package for GitHub skills
    // Join with authors for openmcp block
    const [authorRow] = await db
      .select()
      .from(authors)
      .where(eq(authors.id, skill.authorId!))
      .limit(1)

    const minimalPkg = buildMinimalSkillPackage({
      id: skill.id,
      slug: skill.slug,
      title: skill.title,
      description: skill.description ?? skill.readme,
      version: skill.version,
      priceType: skill.priceType === 'paid' ? 'paid' : 'free',
      authorName: authorRow?.name,
      authorId: authorRow?.id,
    })

    return {
      ok: true,
      delivery: {
        kind: 'github',
        githubUrl: skill.githubUrl,
        installNotes:
          locale === 'zh'
            ? `克隆仓库后按 README 安装：\ngit clone ${skill.githubUrl}`
            : `Clone and follow README:\ngit clone ${skill.githubUrl}`,
        title: skill.title,
        version: skill.version,
        platforms,
        installTips,
        riskWarning,
        downloads,
        // Attach minimal metadata package
        metaPackage: {
          files: minimalPkg.files,
          downloadUrl: `/api/skills/${skill.id}/package`,
        },
      },
    }
  }

  // Get files from version if specified, otherwise from skill
  let files: Array<{ path: string; content: string }> = []
  
  if (versionData) {
    const versionFiles = await getVersionFiles({
      skillId: skill.id,
      version: targetVersion,
    })
    files = versionFiles || []
  } else {
    files = await filesFromSkillRow({
      readme: skill.readme,
      readmeEn: skill.readmeEn,
      metadata: skill.metadata,
    })
  }

  if (files.length === 0) {
    return { ok: false, code: 'NO_CONTENT', error: '暂无可交付的技能文件' }
  }

  return {
    ok: true,
    delivery: {
      kind: 'files',
      files: files.map((f) => ({ path: f.path, content: f.content })),
      title: skill.title,
      version: targetVersion,
      platforms,
      installTips,
      riskWarning,
      downloads,
      downloadUrl: `/api/skills/${skill.id}/download${params.version ? `?version=${params.version}` : ''}`,
    },
  }
}

export async function buildSkillZipBuffer(skillId: string, version?: string): Promise<{
  ok: true
  buffer: Buffer
  filename: string
  files: { path: string; content: string }[]
  name: string
  targetDirs: Record<'cursor' | 'claude-code' | 'codex' | 'generic', string>
} | { ok: false; error: string; status: number }> {
  // P0: Join with authors to get author metadata for openmcp block
  const rows = await db
    .select({
      skill: skills,
      author: authors,
    })
    .from(skills)
    .leftJoin(authors, eq(skills.authorId, authors.id))
    .where(eq(skills.id, skillId))
    .limit(1)

  if (rows.length === 0) return { ok: false, error: '技能未找到', status: 404 }
  const { skill, author } = rows[0]!
  if (skill.status !== 'published') return { ok: false, error: '技能未上架', status: 403 }

  // P1 Gap A: For GitHub skills, generate minimal metadata package only
  if (skill.sourceType === 'github' && skill.githubUrl) {
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

    const buffer = createZipStore(pkg.files.map((f) => ({ path: f.path, content: f.content })))
    const safeName = pkg.name.replace(/[^\w.-]+/g, '_')
    return {
      ok: true,
      buffer,
      filename: `${safeName}-meta.zip`,
      files: pkg.files,
      name: pkg.name,
      targetDirs: pkg.targetDirs,
    }
  }

  // For non-GitHub skills, build full package
  // If version is specified, get files from that version
  let sourceFiles: Array<{ path: string; content: string }> = []
  const targetVersion = version || skill.version || '1.0.0'
  
  if (version) {
    const versionFiles = await getVersionFiles({
      skillId: skill.id,
      version,
    })
    
    if (!versionFiles) {
      return { ok: false, error: '指定的版本不存在或无文件', status: 404 }
    }
    
    sourceFiles = versionFiles
  } else {
    sourceFiles = await filesFromSkillRow({
      readme: skill.readme,
      readmeEn: skill.readmeEn,
      metadata: skill.metadata,
    })
  }

  const pkg = buildSkillPackage({
    id: skill.id,
    slug: skill.slug,
    title: skill.title,
    description: skill.description ?? skill.readme,
    readme: skill.readme,
    readmeEn: skill.readmeEn,
    version: targetVersion,
    priceType: skill.priceType === 'paid' ? 'paid' : 'free',
    authorName: author?.name ?? undefined,
    authorId: author?.id ?? undefined,
    sourceFiles: sourceFiles.map((f) => ({ path: f.path, content: f.content })),
  })

  if (pkg.files.length === 0) return { ok: false, error: '暂无可打包文件', status: 404 }

  const buffer = createZipStore(pkg.files.map((f) => ({ path: f.path, content: f.content })))
  const safeName = pkg.name.replace(/[^\w.-]+/g, '_')
  return {
    ok: true,
    buffer,
    filename: `${safeName}.zip`,
    files: pkg.files,
    name: pkg.name,
    targetDirs: pkg.targetDirs,
  }
}
