import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listAssetInstalls, setAssetInstallStatus } from '@/web/assets/installs'
import { skills, skillInstalls } from '@workspace/db'

/**
 * User-facing install history: what a user has installed.
 *
 * Both kinds live here — skills (`skill_installs`) and the MCP/A2A installs
 * that a gateway call records (`asset_installs`) — because from the user's
 * point of view they are the same thing: an asset they obtained. Rows keep a
 * denormalised copy of the title/slug at the time of the action so entries
 * stay readable after a rename, and they are left-joined against the live
 * record to detect assets that are since gone.
 */

type Locale = 'zh' | 'en'

export type InstallKind = 'skill' | 'mcp' | 'a2a'

export interface InstallRecord {
  id: string
  kind: InstallKind
  /** Skill id or MCP/A2A asset id, whichever produced the row. */
  assetId: string
  runtime: string | null
  installPath: string | null
  status: string
  installedAt: Date
  lastUsedAt: Date | null
  title: string | null
  slug: string | null
  version: string | null
  securityGrade: string | null
  exists: boolean
}

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
  /**
   * Installs recorded for a user, newest first.
   *
   * Skills and MCP/A2A are two queries merged into one list: `skill_installs`
   * needs the live skill join for renames/removals, `asset_installs` needs the
   * live MCP/A2A join for the same reason. The union is sorted once here so
   * the console never has to re-order (and never sees two list shapes).
   */
  listInstalls: async (userId: string, locale: Locale = 'zh'): Promise<InstallRecord[]> => {
    const [rows, assetRows] = await Promise.all([
      db
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
        .orderBy(desc(skillInstalls.installedAt)),
      listAssetInstalls(userId),
    ])

    const skillRows: InstallRecord[] = rows.map((row) => ({
      id: row.id,
      kind: 'skill',
      assetId: row.skillId,
      runtime: row.runtime,
      installPath: row.installPath,
      status: row.status,
      installedAt: row.installedAt,
      lastUsedAt: row.lastUsedAt,
      title: pickTitle(row.current, row.skillTitle, locale),
      slug: row.current?.slug ?? row.skillSlug,
      version: row.current?.version ?? row.skillVersion,
      securityGrade: row.current?.securityGrade ?? null,
      exists: Boolean(row.current),
    }))

    const assetInstallRows: InstallRecord[] = assetRows.map((row) => ({
      id: row.id,
      kind: row.assetType,
      assetId: row.assetId,
      runtime: null,
      installPath: null,
      status: row.status,
      installedAt: row.installedAt,
      lastUsedAt: row.lastUsedAt,
      title: row.assetTitle ?? row.assetName,
      slug: row.assetSlug,
      version: null,
      securityGrade: null,
      exists: row.assetExists,
    }))

    return [...skillRows, ...assetInstallRows].sort(
      (a, b) => b.installedAt.getTime() - a.installedAt.getTime()
    )
  },

  /**
   * Flips an install record between `active` and `removed`. This only records
   * the user's intent; it never touches files on their machine.
   */
  setInstallStatus: async (
    userId: string,
    installId: string,
    status: 'active' | 'removed',
    kind: InstallKind = 'skill'
  ): Promise<{ ok: boolean; error?: string }> => {
    if (kind !== 'skill') return setAssetInstallStatus(userId, installId, status)

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
