/**
 * Skill 版本管理 (Version Management)
 * 支持多版本并存、发布新版本、回滚到旧版本
 */

import { eq, and, desc } from 'drizzle-orm'
import { db } from "@/lib/db"
import { skills, skillVersions } from "@workspace/db"
import { filesFromSkillRow } from "@/lib/security-scan"

/**
 * Simple semver validation (supports x.y.z format with optional pre-release)
 */
function isValidSemver(version: string): boolean {
  const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
  return semverRegex.test(version)
}

export type SkillVersion = {
  id: string
  skillId: string
  version: string
  status: 'draft' | 'published' | 'yanked' | 'archived'
  publishedAt: Date | null
  createdBy: string | null
  changelog: string | null
  securityGrade: string | null
  securityScannedAt: Date | null
  createdAt: Date
  isCurrent: boolean
}

export type SkillVersionDetail = SkillVersion & {
  content: unknown
  sourceFiles: Array<{ path: string; content: string }> | null
  packageMetadata: {
    title?: string
    titleEn?: string
    description?: string
    summary?: string
    platforms?: string[]
  } | null
}

/**
 * 列出某个 Skill 的所有版本（Provider 可见所有状态，User 仅可见 published）
 */
export async function listSkillVersions(params: {
  skillId: string
  userId?: string
  isProvider?: boolean
}): Promise<SkillVersion[]> {
  const conditions = [eq(skillVersions.skillId, params.skillId)]
  
  // Non-provider users only see published versions
  if (!params.isProvider) {
    conditions.push(eq(skillVersions.status, 'published'))
  }

  const rows = await db
    .select({
      version: skillVersions,
      skill: skills,
    })
    .from(skillVersions)
    .leftJoin(skills, eq(skillVersions.skillId, skills.id))
    .where(and(...conditions))
    .orderBy(desc(skillVersions.createdAt))

  return rows.map((row) => ({
    id: row.version.id,
    skillId: row.version.skillId,
    version: row.version.version,
    status: row.version.status as 'draft' | 'published' | 'yanked' | 'archived',
    publishedAt: row.version.publishedAt,
    createdBy: row.version.createdBy,
    changelog: row.version.changelog,
    securityGrade: row.version.securityGrade,
    securityScannedAt: row.version.securityScannedAt,
    createdAt: row.version.createdAt,
    isCurrent: row.skill?.version === row.version.version,
  }))
}

/**
 * 获取特定版本的详细信息
 */
export async function getSkillVersion(params: {
  skillId: string
  version: string
}): Promise<SkillVersionDetail | null> {
  const rows = await db
    .select({
      version: skillVersions,
      skill: skills,
    })
    .from(skillVersions)
    .leftJoin(skills, eq(skillVersions.skillId, skills.id))
    .where(
      and(
        eq(skillVersions.skillId, params.skillId),
        eq(skillVersions.version, params.version)
      )
    )
    .limit(1)

  if (rows.length === 0) return null

  const row = rows[0]!
  return {
    id: row.version.id,
    skillId: row.version.skillId,
    version: row.version.version,
    status: row.version.status as 'draft' | 'published' | 'yanked' | 'archived',
    publishedAt: row.version.publishedAt,
    createdBy: row.version.createdBy,
    changelog: row.version.changelog,
    securityGrade: row.version.securityGrade,
    securityScannedAt: row.version.securityScannedAt,
    createdAt: row.version.createdAt,
    isCurrent: row.skill?.version === row.version.version,
    content: row.version.content,
    sourceFiles: row.version.sourceFiles as Array<{ path: string; content: string }> | null,
    packageMetadata: row.version.packageMetadata as any,
  }
}

/**
 * 创建新版本（Provider only）
 * 从当前 skill 内容创建一个新版本快照
 */
export async function createSkillVersion(params: {
  skillId: string
  version: string
  userId: string
  changelog?: string
  autoPublish?: boolean
}): Promise<{ ok: true; versionId: string } | { ok: false; error: string }> {
  // Validate version format (semver)
  if (!isValidSemver(params.version)) {
    return { ok: false, error: '版本号格式无效，请使用语义化版本（如 1.0.0）' }
  }

  // Check if version already exists
  const existing = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, params.skillId),
        eq(skillVersions.version, params.version)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    return { ok: false, error: '该版本号已存在' }
  }

  // Get current skill data
  const [skill] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, params.skillId))
    .limit(1)

  if (!skill) {
    return { ok: false, error: 'Skill 不存在' }
  }

  // Get source files
  const sourceFiles = await filesFromSkillRow({
    readme: skill.readme,
    readmeEn: skill.readmeEn,
    metadata: skill.metadata,
  })

  // Create version record
  const status: 'published' | 'draft' = params.autoPublish ? 'published' : 'draft'
  const versionRow: typeof skillVersions.$inferInsert = {
      skillId: params.skillId,
      version: params.version,
      content: {
        readme: skill.readme,
        readmeEn: skill.readmeEn,
        description: skill.description,
        metadata: skill.metadata,
      },
      changelog: params.changelog || `发布版本 ${params.version}`,
      status,
      publishedAt: params.autoPublish ? new Date() : null,
      createdBy: params.userId,
      sourceFiles: sourceFiles.map((f) => ({ path: f.path, content: f.content })),
      packageMetadata: {
        // The columns are nullable; the jsonb type models absent keys, so
        // normalise null to undefined rather than writing nulls.
        title: skill.title ?? undefined,
        titleEn: skill.titleEn ?? undefined,
        description: skill.description ?? undefined,
        summary: skill.summary ?? undefined,
        platforms: skill.platforms as string[],
      },
    securityGrade: skill.securityGrade ?? undefined,
    securityScannedAt: skill.scannedAt ?? undefined,
  }
  const [newVersion] = await db.insert(skillVersions).values(versionRow).returning()

  if (!newVersion) {
    return { ok: false, error: '版本创建失败' }
  }

  // If auto-publish, update skills.version to point to new version
  if (params.autoPublish) {
    await db
      .update(skills)
      .set({ 
        version: params.version,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, params.skillId))
  }

  return { ok: true, versionId: newVersion.id }
}

/**
 * 发布一个草稿版本（Provider only）
 */
export async function publishSkillVersion(params: {
  skillId: string
  version: string
  userId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [versionRecord] = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, params.skillId),
        eq(skillVersions.version, params.version)
      )
    )
    .limit(1)

  if (!versionRecord) {
    return { ok: false, error: '版本不存在' }
  }

  if (versionRecord.status === 'published') {
    return { ok: false, error: '该版本已经发布' }
  }

  await db
    .update(skillVersions)
    .set({
      status: 'published',
      publishedAt: new Date(),
    })
    .where(eq(skillVersions.id, versionRecord.id))

  return { ok: true }
}

/**
 * 设置当前版本（回滚功能，Provider only）
 * 将 skills.version 指向指定的已发布版本
 */
export async function setCurrentVersion(params: {
  skillId: string
  version: string
  userId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Check if version exists and is published
  const [versionRecord] = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, params.skillId),
        eq(skillVersions.version, params.version)
      )
    )
    .limit(1)

  if (!versionRecord) {
    return { ok: false, error: '版本不存在' }
  }

  if (versionRecord.status !== 'published') {
    return { ok: false, error: '只能设置已发布的版本为当前版本' }
  }

  // Update skills.version to point to this version
  await db
    .update(skills)
    .set({
      version: params.version,
      updatedAt: new Date(),
    })
    .where(eq(skills.id, params.skillId))

  return { ok: true }
}

/**
 * Yank（撤回）一个版本（Provider only）
 * 将版本状态设为 yanked，用户无法再下载，但已下载的不受影响
 */
export async function yankSkillVersion(params: {
  skillId: string
  version: string
  userId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [versionRecord] = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, params.skillId),
        eq(skillVersions.version, params.version)
      )
    )
    .limit(1)

  if (!versionRecord) {
    return { ok: false, error: '版本不存在' }
  }

  // Check if this is the current version
  const [skill] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, params.skillId))
    .limit(1)

  if (skill?.version === params.version) {
    return { ok: false, error: '当前正在使用的版本不能被撤回，请先设置其他版本为当前版本' }
  }

  await db
    .update(skillVersions)
    .set({
      status: 'yanked',
    })
    .where(eq(skillVersions.id, versionRecord.id))

  return { ok: true }
}

/**
 * 获取特定版本的文件内容（用于下载）
 */
export async function getVersionFiles(params: {
  skillId: string
  version: string
}): Promise<Array<{ path: string; content: string }> | null> {
  const versionDetail = await getSkillVersion(params)
  if (!versionDetail) return null

  // Try sourceFiles first (new format)
  if (versionDetail.sourceFiles && versionDetail.sourceFiles.length > 0) {
    return versionDetail.sourceFiles
  }

  // Fallback to content.readme for legacy versions
  const content = versionDetail.content as any
  if (content?.readme || content?.readmeEn || content?.metadata) {
    return filesFromSkillRow({
      readme: content.readme,
      readmeEn: content.readmeEn,
      metadata: content.metadata,
    })
  }

  return null
}
