/**
 * Skill persistence.
 *
 * One row per (project, skill directory) holding the parsed SKILL.md in both
 * languages, plus the state of the downstream push so a failed push is
 * visible and retryable rather than lost.
 */

import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { projectSkills, projects, repos } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import { contentHash, type ParsedSkill } from "@/lib/github/skill"

type SkillRow = typeof projectSkills.$inferSelect

export interface SkillInput extends ParsedSkill {
  projectId: string
  skillDir: string
  descriptionZh?: string
  readmeZh?: string
}

function toSkillRow(input: SkillInput) {
  return {
    name: input.name,
    description: input.description,
    descriptionZh: input.descriptionZh ?? "",
    readme: input.readme,
    readmeZh: input.readmeZh ?? "",
    version: input.version,
    // Hashed from the source document, not from the parsed fields, so a
    // whitespace-only change upstream is still seen as a change.
    contentHash: contentHash(input.readme),
    updatedAt: new Date(),
  }
}

/**
 * Stores a parsed skill.
 *
 * The push state is deliberately not written here: `syncedToWebAt` and
 * `lastSyncError` describe a downstream attempt, and a fresh parse that has
 * not been pushed yet must read as pending rather than as already synced.
 */
export async function upsertSkill(db: Db, input: SkillInput): Promise<void> {
  const row = toSkillRow(input)
  await db
    .insert(projectSkills)
    .values({
      id: nanoid(),
      projectId: input.projectId,
      skillDir: input.skillDir,
      ...row,
    })
    .onConflictDoUpdate({
      target: [projectSkills.projectId, projectSkills.skillDir],
      set: row,
    })
}

/**
 * Replaces a project's skills with the set just discovered.
 *
 * Directories that have been deleted upstream are removed here, otherwise a
 * removed skill would be published forever. The delete is scoped to the
 * project and the incoming set is applied in the same transaction, so a
 * half-applied sync cannot leave the project with no skills at all.
 */
export async function syncProjectSkills(
  db: Db,
  projectId: string,
  skills: SkillInput[]
): Promise<void> {
  const dirs = skills.map((skill) => skill.skillDir)

  await db.transaction(async (tx) => {
    if (dirs.length > 0) {
      // Only directories that are absent from the new set are removed, so an
      // unchanged skill is never briefly missing.
      await tx.delete(projectSkills).where(
        and(
          eq(projectSkills.projectId, projectId),
          // NOT IN built by joining the values as literals, because an
          // empty array cannot be bound to an IN clause. The `dirs.length`
          // guard above is what keeps this list non-empty.
          sql`${projectSkills.skillDir} NOT IN (${sql.join(
            dirs.map((dir) => sql`${dir}`),
            sql`, `
          )})`
        )
      )
    } else {
      // An empty discovery is ambiguous: either the repository has no skills
      // or the listing failed. Deleting everything on a transient failure
      // would unpublish a working project, so nothing is removed.
      return
    }

    for (const skill of skills) {
      const row = toSkillRow(skill)
      await tx
        .insert(projectSkills)
        .values({
          id: nanoid(),
          projectId,
          skillDir: skill.skillDir,
          ...row,
        })
        .onConflictDoUpdate({
          target: [projectSkills.projectId, projectSkills.skillDir],
          set: row,
        })
    }
  })
}

export async function recordPushAttempt(
  db: Db,
  projectId: string,
  skillDir: string,
  attemptedAt: Date
): Promise<void> {
  await db
    .update(projectSkills)
    .set({ lastSyncAttemptAt: attemptedAt })
    .where(
      and(
        eq(projectSkills.projectId, projectId),
        eq(projectSkills.skillDir, skillDir)
      )
    )
}

/** Records a successful push, clearing any previous error. */
export async function recordPushSuccess(
  db: Db,
  projectId: string,
  skillDir: string,
  at: Date
): Promise<void> {
  await db
    .update(projectSkills)
    .set({ syncedToWebAt: at, lastSyncError: null, lastSyncAttemptAt: at })
    .where(
      and(
        eq(projectSkills.projectId, projectId),
        eq(projectSkills.skillDir, skillDir)
      )
    )
}

/**
 * Records a failed push.
 *
 * The row is kept: the error is what lets the retry task find it, and
 * `syncedToWebAt` is left alone so the last known good state is not lost.
 */
export async function recordPushFailure(
  db: Db,
  projectId: string,
  skillDir: string,
  error: string,
  at: Date
): Promise<void> {
  await db
    .update(projectSkills)
    .set({ lastSyncError: error.slice(0, 2000), lastSyncAttemptAt: at })
    .where(
      and(
        eq(projectSkills.projectId, projectId),
        eq(projectSkills.skillDir, skillDir)
      )
    )
}

export async function getSkill(
  db: Db,
  projectId: string,
  skillDir: string
): Promise<SkillRow | undefined> {
  return db.query.projectSkills.findFirst({
    where: and(
      eq(projectSkills.projectId, projectId),
      eq(projectSkills.skillDir, skillDir)
    ),
  })
}

export async function listSkillsForProject(
  db: Db,
  projectId: string
): Promise<SkillRow[]> {
  return db
    .select()
    .from(projectSkills)
    .where(eq(projectSkills.projectId, projectId))
    .orderBy(asc(projectSkills.skillDir))
}

/** Skills that have never been pushed downstream. */
export async function listUnpushedSkills(db: Db): Promise<SkillRow[]> {
  return db
    .select()
    .from(projectSkills)
    .where(isNull(projectSkills.syncedToWebAt))
    .orderBy(asc(projectSkills.skillDir))
}

/** Skills whose last push failed, oldest attempt first. */
export async function listFailedSkills(db: Db): Promise<SkillRow[]> {
  return db
    .select()
    .from(projectSkills)
    .where(sql`${projectSkills.lastSyncError} IS NOT NULL`)
    .orderBy(asc(projectSkills.lastSyncAttemptAt))
}

/** Skills that have never been pushed, or whose last push failed. */
export async function listSkillsNeedingPush(db: Db): Promise<SkillRow[]> {
  return db
    .select()
    .from(projectSkills)
    .where(
      or(
        isNull(projectSkills.syncedToWebAt),
        sql`${projectSkills.lastSyncError} IS NOT NULL`
      )
    )
    .orderBy(asc(projectSkills.skillDir))
}

export interface SkillNeedingPush {
  skill: SkillRow
  project: typeof projects.$inferSelect
  repo: typeof repos.$inferSelect
}

/**
 * Skills needing a push, with the project and repository the payload is
 * built from. The webhook identifies its subject by repository, so a skill
 * row alone cannot be sent.
 */
export async function listSkillsNeedingPushJoined(
  db: Db
): Promise<SkillNeedingPush[]> {
  return db
    .select({ skill: projectSkills, project: projects, repo: repos })
    .from(projectSkills)
    .innerJoin(projects, eq(projectSkills.projectId, projects.id))
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(
      or(
        isNull(projectSkills.syncedToWebAt),
        sql`${projectSkills.lastSyncError} IS NOT NULL`
      )
    )
    .orderBy(asc(projectSkills.skillDir))
}

export interface SkillProject {
  project: typeof projects.$inferSelect
  repo: typeof repos.$inferSelect
}

export interface SkillExport {
  skill: typeof projectSkills.$inferSelect
  project: typeof projects.$inferSelect
  repo: typeof repos.$inferSelect
}

export interface SkillExportOptions {
  /** Only skills not yet acknowledged as synced, when omitted. */
  cursor?: Date
  limit: number
}

/**
 * A page of skills for the export endpoint, ordered by the cursor.
 *
 * The cursor is `syncedToWebAt`, which is indexed for exactly this. A skill
 * that has never been sent has a null there, and nulls sort first, so a
 * consumer walking the cursor with no starting point sees the unsynced work
 * before the backlog it has already processed.
 *
 * The page is `limit + 1` rows so the caller can tell "there is more" from
 * "this was the last page" without a second count query.
 */
export async function listSkillsForExport(
  db: Db,
  options: SkillExportOptions
): Promise<SkillExport[]> {
  return db
    .select({ skill: projectSkills, project: projects, repo: repos })
    .from(projectSkills)
    .innerJoin(projects, eq(projectSkills.projectId, projects.id))
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(
      options.cursor
        ? or(
            isNull(projectSkills.syncedToWebAt),
            gt(projectSkills.syncedToWebAt, options.cursor)
          )
        : isNull(projectSkills.syncedToWebAt)
    )
    .orderBy(asc(projectSkills.syncedToWebAt), asc(projectSkills.id))
    .limit(options.limit + 1)
}

/** Skill projects with their repository, for a sync run. */
export async function listSkillProjects(db: Db): Promise<SkillProject[]> {
  const rows = await db
    .select({ project: projects, repo: repos })
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(eq(projects.type, "skill"))
    .orderBy(asc(projects.slug))

  return rows
}

/** Projects whose last push attempt is older than the cutoff. */
export async function listProjectsNeedingPush(
  db: Db,
  before: Date
): Promise<SkillProject[]> {
  const rows = await db
    .select({ project: projects, repo: repos })
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(eq(projects.type, "skill"))
    .orderBy(asc(projects.slug))

  const projectIds = rows.map((row) => row.project.id)
  if (projectIds.length === 0) return []

  // A project with no skill rows has never been attempted, so it is included
  // regardless of the cutoff; only rows with a stale attempt are filtered.
  const attempts = await db
    .select({
      projectId: projectSkills.projectId,
      latest: sql<Date>`max(${projectSkills.lastSyncAttemptAt})`,
    })
    .from(projectSkills)
    .where(inArray(projectSkills.projectId, projectIds))
    .groupBy(projectSkills.projectId)

  const stale = new Set(
    attempts
      .filter((row) => row.latest && new Date(row.latest) < before)
      .map((row) => row.projectId)
  )

  return rows.filter(
    (row) =>
      !attempts.some((a) => a.projectId === row.project.id) ||
      stale.has(row.project.id)
  )
}

export async function deleteSkillsForProject(
  db: Db,
  projectId: string
): Promise<void> {
  await db.delete(projectSkills).where(eq(projectSkills.projectId, projectId))
}

export type { SkillRow }
