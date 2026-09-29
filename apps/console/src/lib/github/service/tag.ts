/**
 * Tag persistence and project-to-tag assignment.
 *
 * The exclusion rule lives on the tag row (`excludeFromRankings`) rather than
 * in each caller, so anything that reads a project's ranking tags gets the
 * stored answer. `TAGS_EXCLUDED_FROM_RANKINGS` only sets the default for a
 * newly created tag, carrying the source app's hardcoded list forward without
 * any comparison remaining at ranking time.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { projectsToTags, tags, TAGS_EXCLUDED_FROM_RANKINGS } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

type TagRow = typeof tags.$inferSelect

export interface UpsertTagInput {
  code: string
  name: string
  description?: string | null
  aliases?: string[]
  /**
   * Whether projects carrying the tag are left out of the rankings.
   *
   * Defaults to membership in `TAGS_EXCLUDED_FROM_RANKINGS` for a new tag and
   * to the row's current value for an existing one, so editing a tag's display
   * name does not silently change whether it lands on the list.
   */
  excludeFromRankings?: boolean | null
}

/**
 * Creates a tag, or updates the mutable fields of one that already exists.
 *
 * `code` is the stable identifier and is never rewritten, so renaming a tag
 * for display cannot break the assignments that reference it.
 */
export async function upsertTag(
  db: Db,
  input: UpsertTagInput
): Promise<TagRow> {
  const existing = await getTagByCode(db, input.code)
  const excludeFromRankings =
    input.excludeFromRankings ??
    (existing
      ? existing.excludeFromRankings
      : TAGS_EXCLUDED_FROM_RANKINGS.includes(input.code))

  const [row] = await db
    .insert(tags)
    .values({
      id: nanoid(),
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      aliases: input.aliases ?? [],
      excludeFromRankings,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tags.code,
      set: {
        name: input.name,
        description: input.description ?? null,
        aliases: input.aliases ?? [],
        excludeFromRankings,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error(`Failed to upsert tag ${input.code}`)
  return row
}

export async function getTagByCode(
  db: Db,
  code: string
): Promise<TagRow | undefined> {
  return db.query.tags.findFirst({ where: eq(tags.code, code) })
}

export async function listTags(db: Db): Promise<TagRow[]> {
  return db.select().from(tags).orderBy(tags.name)
}

/** Resolves codes to tags, keeping only those that exist. */
export async function getTagsByCodes(
  db: Db,
  codes: string[]
): Promise<Map<string, TagRow>> {
  const byCode = new Map<string, TagRow>()
  if (codes.length === 0) return byCode

  const rows = await db.select().from(tags).where(inArray(tags.code, codes))
  for (const row of rows) byCode.set(row.code, row)
  return byCode
}

/**
 * Replaces a project's tags with exactly the given set.
 *
 * Written as a delete-then-insert inside a transaction so a concurrent read
 * never observes a project with no tags, and so a failure part-way through
 * cannot leave a partial set behind.
 */
export async function setProjectTags(
  db: Db,
  projectId: string,
  tagCodes: string[]
): Promise<void> {
  const wanted = [...new Set(tagCodes)]

  await db.transaction(async (tx) => {
    await tx
      .delete(projectsToTags)
      .where(eq(projectsToTags.projectId, projectId))

    if (wanted.length === 0) return

    const known = await tx
      .select({ id: tags.id, code: tags.code })
      .from(tags)
      .where(inArray(tags.code, wanted))

    // Every requested tag must exist. Failing loudly beats silently
    // assigning the subset that resolved, which would quietly drop a tag
    // from a ranking with no indication that anything went wrong.
    if (known.length !== wanted.length) {
      const found = new Set(known.map((tag) => tag.code))
      const missing = wanted.filter((code) => !found.has(code))
      throw new Error(`Unknown tag codes: ${missing.join(", ")}`)
    }

    await tx
      .insert(projectsToTags)
      .values(known.map((tag) => ({ projectId, tagId: tag.id })))
  })
}

export async function addProjectTag(
  db: Db,
  projectId: string,
  tagCode: string
): Promise<void> {
  const tag = await getTagByCode(db, tagCode)
  if (!tag) throw new Error(`Unknown tag: ${tagCode}`)

  await db
    .insert(projectsToTags)
    .values({ projectId, tagId: tag.id })
    .onConflictDoNothing()
}

export async function removeProjectTag(
  db: Db,
  projectId: string,
  tagCode: string
): Promise<void> {
  const tag = await getTagByCode(db, tagCode)
  if (!tag) return
  await db
    .delete(projectsToTags)
    .where(
      and(
        eq(projectsToTags.projectId, projectId),
        eq(projectsToTags.tagId, tag.id)
      )
    )
}

/** All tags assigned to a project. */
export async function listProjectTags(
  db: Db,
  projectId: string
): Promise<TagRow[]> {
  const rows = await db
    .select({ tag: tags })
    .from(projectsToTags)
    .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(eq(projectsToTags.projectId, projectId))
  return rows.map(({ tag }) => tag)
}

/** Tags of a project that are allowed to influence a ranking. */
export async function listRankingTags(
  db: Db,
  projectId: string
): Promise<TagRow[]> {
  return db
    .select({ tag: tags })
    .from(projectsToTags)
    .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(
      and(
        eq(projectsToTags.projectId, projectId),
        // Reads the column, not the default list: the list only decided the
        // value when the tag was created, and an editor may have since changed
        // it. The exclusion is whatever the tag row currently says.
        eq(tags.excludeFromRankings, false)
      )
    )
    .then((rows) => rows.map(({ tag }) => tag))
}

/** Every tag in use, with the number of projects carrying it. */
export async function tagUsage(
  db: Db
): Promise<{ code: string; name: string; count: number }[]> {
  const rows = await db
    .select({
      code: tags.code,
      name: tags.name,
      count: sql<number>`count(${projectsToTags.projectId})::int`,
    })
    .from(tags)
    .leftJoin(projectsToTags, eq(projectsToTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(sql`count(${projectsToTags.projectId}) desc`)

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    count: Number(row.count),
  }))
}

export async function deleteTag(db: Db, id: string): Promise<void> {
  await db.delete(tags).where(eq(tags.id, id))
}

export type { TagRow }
