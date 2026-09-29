import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { skills, skillDownloads, skillInstalls } from '@workspace/db'

/**
 * User-facing skill history: what a user has downloaded and what they have
 * installed. Rows keep a denormalised copy of the skill title/slug at the time
 * of the action so entries stay readable after a skill is renamed, and they are
 * left-joined against the live record to detect skills that are since gone.
 */

type Locale = 'zh' | 'en'

const currentSkillColumns = {
  id: skills.id,
  title: skills.title,
  titleEn: skills.titleEn,
  slug: skills.slug,
  version: skills.version,
  securityGrade: skills.securityGrade,
}

function pickTitle(
  current: { title: string | null; titleEn: string | null } | null,
  fallback: string | null,
  locale: Locale
): string | null {
  if (current) {
    return locale === 'zh' ? current.title || current.titleEn : current.titleEn || current.title
  }
  return fallback
}

export const skillsHistoryAccess = {
  /** Downloads recorded for a user, newest first. */
  listDownloads: async (userId: string, locale: Locale = 'zh') => {
    const rows = await db
      .select({
        id: skillDownloads.id,
        skillId: skillDownloads.skillId,
        status: skillDownloads.status,
        downloadedAt: skillDownloads.downloadedAt,
        skillTitle: skillDownloads.skillTitle,
        skillSlug: skillDownloads.skillSlug,
        skillVersion: skillDownloads.skillVersion,
        current: currentSkillColumns,
      })
      .from(skillDownloads)
      .leftJoin(skills, eq(skillDownloads.skillId, skills.id))
      .where(eq(skillDownloads.userId, userId))
      .orderBy(desc(skillDownloads.downloadedAt))

    return rows.map((row) => ({
      id: row.id,
      skillId: row.skillId,
      status: row.status,
      downloadedAt: row.downloadedAt,
      skillTitle: pickTitle(row.current, row.skillTitle, locale),
      skillSlug: row.current?.slug ?? row.skillSlug,
      skillVersion: row.current?.version ?? row.skillVersion,
      securityGrade: row.current?.securityGrade ?? null,
      skillExists: Boolean(row.current),
    }))
  },

  /** Installs recorded for a user, newest first. */
  listInstalls: async (userId: string, locale: Locale = 'zh') => {
    const rows = await db
      .select({
        id: skillInstalls.id,
        skillId: skillInstalls.skillId,
        runtime: skillInstalls.runtime,
        installPath: skillInstalls.installPath,
        status: skillInstalls.status,
        installedAt: skillInstalls.installedAt,
        lastUsedAt: skillInstalls.lastUsedAt,
        skillTitle: skillInstalls.skillTitle,
        skillSlug: skillInstalls.skillSlug,
        skillVersion: skillInstalls.skillVersion,
        current: currentSkillColumns,
      })
      .from(skillInstalls)
      .leftJoin(skills, eq(skillInstalls.skillId, skills.id))
      .where(eq(skillInstalls.userId, userId))
      .orderBy(desc(skillInstalls.installedAt))

    return rows.map((row) => ({
      id: row.id,
      skillId: row.skillId,
      runtime: row.runtime,
      installPath: row.installPath,
      status: row.status,
      installedAt: row.installedAt,
      lastUsedAt: row.lastUsedAt,
      skillTitle: pickTitle(row.current, row.skillTitle, locale),
      skillSlug: row.current?.slug ?? row.skillSlug,
      skillVersion: row.current?.version ?? row.skillVersion,
      securityGrade: row.current?.securityGrade ?? null,
      skillExists: Boolean(row.current),
    }))
  },

  /**
   * Flips an install record between `active` and `removed`. This only records
   * the user's intent; it never touches files on their machine.
   */
  setInstallStatus: async (
    userId: string,
    installId: string,
    status: 'active' | 'removed'
  ): Promise<{ ok: boolean; error?: string }> => {
    const [row] = await db
      .select({ id: skillInstalls.id })
      .from(skillInstalls)
      .where(and(eq(skillInstalls.id, installId), eq(skillInstalls.userId, userId)))
      .limit(1)

    if (!row) return { ok: false, error: '安装记录不存在' }

    await db
      .update(skillInstalls)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(skillInstalls.id, installId), eq(skillInstalls.userId, userId)))

    return { ok: true }
  },

  /** True when a skill is already installed and still active for the user. */
  hasInstall: async (userId: string, skillId: string) => {
    const [row] = await db
      .select({ id: skillInstalls.id })
      .from(skillInstalls)
      .where(
        and(
          eq(skillInstalls.userId, userId),
          eq(skillInstalls.skillId, skillId),
          eq(skillInstalls.status, 'active')
        )
      )
      .limit(1)

    return Boolean(row)
  },
}
