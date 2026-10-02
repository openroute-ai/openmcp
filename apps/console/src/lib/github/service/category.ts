/**
 * The project taxonomy: categories, capabilities, and their assignment.
 *
 * Three separate things live here because they are three separate questions:
 *
 * - a **category** is one bucket per project, chosen from a list an admin
 *   curates. It answers "what kind of thing is this", and the answer is a
 *   single value because a project that is simultaneously a framework and a
 *   database is a project whose landing page has not been written yet.
 * - **capabilities** are the machine-fillable properties that answer the
 *   questions a category cannot: which language, which deployment, which data
 *   source. They are a closed vocabulary per axis, so "every project that
 *   speaks Postgres" is a lookup rather than a text search.
 * - **tags** stay where they already are (`service/tag.ts`). A tag is a curated
 *   label, a capability is a machine-readable property, and merging the two is
 *   what produces a taxonomy nobody can filter — see the note on
 *   {@link capabilities}.
 *
 * The assignment paths here are the only writers, so the count limits are
 * enforced in one place rather than at each caller: a project keeps 3-5
 * capabilities and at most 3 tags no matter which surface asked.
 */

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  categories,
  capabilities,
  MAX_CAPABILITIES_PER_PROJECT,
  MIN_CAPABILITIES_PER_PROJECT,
  projects,
  projectsToCapabilities,
  type CapabilityAxis,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

type CategoryRow = typeof categories.$inferSelect
type CapabilityRow = typeof capabilities.$inferSelect

export interface UpsertCategoryInput {
  code: string
  name: string
  description?: string | null
  isActive?: boolean
  sortOrder?: number
}

/**
 * Creates a category, or edits the mutable fields of one that already exists.
 *
 * `code` is the stable identifier and is never rewritten, for the same reason
 * `tags.code` is: it is the value the classifier is allowed to answer with, so
 * renaming a category must not orphan the `category_id` of every project filed
 * under it. A caller that wants a different slug creates a new category and
 * retires the old one with `isActive: false`.
 */
export async function upsertCategory(
  db: Db,
  input: UpsertCategoryInput
): Promise<CategoryRow> {
  const [row] = await db
    .insert(categories)
    .values({
      id: nanoid(),
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: categories.code,
      set: {
        name: input.name,
        description: input.description ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error(`Failed to upsert category ${input.code}`)
  return row
}

export async function getCategoryByCode(
  db: Db,
  code: string
): Promise<CategoryRow | undefined> {
  return db.query.categories.findFirst({ where: eq(categories.code, code) })
}

/**
 * The category list, in the order an operator arranged it.
 *
 * `activeOnly` is what the classifier is given: a retired category must not
 * come back as an answer, but it still has to be listed in the admin view so
 * an operator can see what happened to the projects filed under it.
 */
export async function listCategories(
  db: Db,
  options: { activeOnly?: boolean } = {}
): Promise<CategoryRow[]> {
  return db
    .select()
    .from(categories)
    .where(options.activeOnly ? eq(categories.isActive, true) : undefined)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
}

/** Deletes a category, returning every project it still had to NULL. */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id))
}

/** Every category with the number of projects filed under it. */
export async function categoryUsage(
  db: Db
): Promise<{ code: string; name: string; count: number }[]> {
  const rows = await db
    .select({
      code: categories.code,
      name: categories.name,
      count: sql<number>`count(${projects.categoryId})::int`,
    })
    .from(categories)
    .leftJoin(projects, eq(projects.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(sql`count(${projects.categoryId}) desc`)

  return rows
}

// --- capabilities ------------------------------------------------------------

export interface UpsertCapabilityInput {
  axis: CapabilityAxis
  code: string
  label: string
  description?: string | null
}

/**
 * Creates a capability value, or edits the label of one that already exists.
 *
 * Uniqueness is per axis, so `en` can be a `language` and a `category`
 * without colliding — which is the point of having axes.
 */
export async function upsertCapability(
  db: Db,
  input: UpsertCapabilityInput
): Promise<CapabilityRow> {
  const [row] = await db
    .insert(capabilities)
    .values({
      id: nanoid(),
      axis: input.axis,
      code: input.code,
      label: input.label,
      description: input.description ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [capabilities.axis, capabilities.code],
      set: {
        label: input.label,
        description: input.description ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) {
    throw new Error(`Failed to upsert capability ${input.axis}/${input.code}`)
  }
  return row
}

export async function listCapabilities(db: Db): Promise<CapabilityRow[]> {
  return db
    .select()
    .from(capabilities)
    .orderBy(asc(capabilities.axis), asc(capabilities.code))
}

/** Deletes a capability value, dropping it from every project carrying it. */
export async function deleteCapability(db: Db, id: string): Promise<void> {
  await db.delete(capabilities).where(eq(capabilities.id, id))
}

// --- assignment --------------------------------------------------------------

/**
 * Files a project under a category by hand.
 *
 * Clears the model's score and sentence on the way in: the column pair means
 * "what the classifier thought", and once an operator has decided, leaving the
 * old justification next to the new decision would let a reviewer read a
 * rationale for an answer that is no longer being given. `reviewedAt` is set
 * instead, which is what takes the project out of the review queue.
 */
export async function setProjectCategory(
  db: Db,
  projectId: string,
  categoryId: string | null
): Promise<void> {
  await db
    .update(projects)
    .set({
      categoryId,
      categoryConfidence: null,
      categoryEvidence: null,
      categoryReviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}

/**
 * Records what the classifier decided, and leaves it unreviewed.
 *
 * `reviewedAt` is deliberately not touched: a re-run overwrites the score and
 * the sentence while leaving the queue exactly as it was, so an operator who
 * has half-worked through the backlog is not sent back to the start by a
 * scheduled task.
 */
export async function recordProjectClassification(
  db: Db,
  projectId: string,
  decision: { categoryId: string; confidence: number; evidence: string }
): Promise<void> {
  await db
    .update(projects)
    .set({
      categoryId: decision.categoryId,
      categoryConfidence: decision.confidence,
      categoryEvidence: decision.evidence,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}

export interface CapabilityAssignment {
  capabilityId: string
  evidence?: string | null
  confidence?: number | null
}

/**
 * Replaces a project's capabilities with exactly the given set.
 *
 * The 3-5 band is enforced here rather than trusted from the caller, because
 * the caller is a language model: a prompt that says "between three and five"
 * is a request, not a guarantee, and the table's primary key would happily
 * accept one capability or fifty. Refusing loudly is the point — a project that
 * failed to classify should stay unclassified and visible in the backlog, not
 * be filed under whatever the model managed to produce.
 *
 * Written as a delete-then-insert inside a transaction so a concurrent read
 * never observes a project with no capabilities part-way through a re-run.
 */
export async function assignProjectCapabilities(
  db: Db,
  projectId: string,
  assignments: CapabilityAssignment[]
): Promise<void> {
  const wanted = new Map<string, CapabilityAssignment>()
  for (const assignment of assignments) {
    // `rejected` rows are an operator's "not this one"; re-applying one would
    // undo a decision that was made on purpose.
    wanted.set(assignment.capabilityId, assignment)
  }
  if (wanted.size < MIN_CAPABILITIES_PER_PROJECT) {
    throw new Error(
      `A project needs at least ${MIN_CAPABILITIES_PER_PROJECT} capabilities, received ${wanted.size}`
    )
  }
  if (wanted.size > MAX_CAPABILITIES_PER_PROJECT) {
    throw new Error(
      `A project may carry at most ${MAX_CAPABILITIES_PER_PROJECT} capabilities, received ${wanted.size}`
    )
  }

  await db.transaction(async (tx) => {
    const known = await tx
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(inArray(capabilities.id, [...wanted.keys()]))
    if (known.length !== wanted.size) {
      const found = new Set(known.map((row) => row.id))
      const missing = [...wanted.keys()].filter((id) => !found.has(id))
      throw new Error(`Unknown capability ids: ${missing.join(", ")}`)
    }

    await tx
      .delete(projectsToCapabilities)
      .where(eq(projectsToCapabilities.projectId, projectId))

    await tx.insert(projectsToCapabilities).values(
      [...wanted.values()].map((assignment) => ({
        projectId,
        capabilityId: assignment.capabilityId,
        evidence: assignment.evidence ?? null,
        confidence: assignment.confidence ?? null,
      }))
    )
  })
}

/** A project's capabilities, with the sentence each was assigned for. */
export async function listProjectCapabilities(
  db: Db,
  projectId: string
): Promise<
  { capability: CapabilityRow; evidence: string | null; confidence: number | null }[]
> {
  const rows = await db
    .select({
      capability: capabilities,
      evidence: projectsToCapabilities.evidence,
      confidence: projectsToCapabilities.confidence,
    })
    .from(projectsToCapabilities)
    .innerJoin(
      capabilities,
      eq(projectsToCapabilities.capabilityId, capabilities.id)
    )
    .where(eq(projectsToCapabilities.projectId, projectId))

  return rows
}

/**
 * Projects waiting for a reviewer, worst-confidence first.
 *
 * Sorted by score rather than by name because the queue exists to be worked
 * through: a row the model was unsure about is the one a human should look at,
 * and an operator who disagrees can correct it in seconds while an operator
 * staring at 300 confident rows would not.
 */
export async function listCategoryReviewQueue(
  db: Db,
  limit = 100
): Promise<
  {
    id: string
    name: string
    owner: string
    categoryCode: string | null
    categoryName: string | null
    confidence: number | null
    evidence: string | null
    updatedAt: Date | null
  }[]
> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      categoryCode: categories.code,
      categoryName: categories.name,
      confidence: projects.categoryConfidence,
      evidence: projects.categoryEvidence,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(categories, eq(projects.categoryId, categories.id))
    .where(
      and(
        isNull(projects.categoryReviewedAt),
        isNotNull(projects.categoryId)
      )
    )
    .orderBy(sql`${projects.categoryConfidence} asc nulls last`)
    .limit(limit)
}

export type { CategoryRow, CapabilityRow }
