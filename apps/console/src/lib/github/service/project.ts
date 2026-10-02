/**
 * Project persistence.
 *
 * A project is the console's curated view of a repository: it carries the
 * editorial fields (slug, status, priority, comments) that the raw GitHub
 * data does not have, plus the overrides a human may have applied.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  projects,
  repos,
  type ProjectStatus,
  type ProjectType,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import { recomputePlatformStates } from "@/lib/github/service/user-repo"

type ProjectRow = typeof projects.$inferSelect

export type ProjectWithRepo = ProjectRow & { repo: typeof repos.$inferSelect }

/**
 * Stand-in for a project that has no description of its own.
 *
 * Stored rather than left empty, because a project is listed even when nothing
 * is known about it and an empty cell reads as a bug.
 *
 * Named because it is stored in the data, which means it is indistinguishable
 * from a real description once written. Consumers that want to fall back to
 * something else - the ranking falls back to the repository description -
 * must compare against this rather than against an empty string.
 */
export const NO_DESCRIPTION = "(No description)"

export interface CreateProjectInput {
  repoId: string
  name: string
  owner: string
  slug: string
  description?: string
  url?: string | null
  status?: ProjectStatus
  type?: ProjectType
  logo?: string | null
  twitter?: string | null
  priority?: number
  comments?: string | null
  skillMdPath?: string | null
}

/**
 * Turns a project name into a URL slug.
 *
 * Applied the same way to every project so two repositories that normalise
 * to the same slug surface the collision as a constraint violation rather
 * than as two projects sharing a URL.
 */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * Appends a numeric suffix until the slug is free.
 *
 * `slug` is globally unique, so a name collision across different owners is
 * normal and must be resolved here rather than by failing the insert.
 */
export async function generateUniqueSlug(
  db: Db,
  base: string,
  taken: ReadonlySet<string> = new Set()
): Promise<string> {
  const root = slugify(base) || "project"
  const used = new Set(taken)

  let candidate = root
  for (let suffix = 2; ; suffix += 1) {
    const existing = await db.query.projects.findFirst({
      where: eq(projects.slug, candidate),
      columns: { id: true },
    })
    if (!existing && !used.has(candidate)) return candidate
    candidate = `${root}-${suffix}`
  }
}

export async function createProject(
  db: Db,
  input: CreateProjectInput
): Promise<ProjectRow> {
  const [row] = await db
    .insert(projects)
    .values({
      id: nanoid(),
      repoId: input.repoId,
      name: input.name,
      owner: input.owner,
      slug: input.slug,
      // A project with no description is still listed, so it gets a
      // placeholder rather than an empty cell.
      description: input.description || NO_DESCRIPTION,
      url: input.url ?? null,
      status: input.status ?? "active",
      type: input.type ?? "application",
      logo: input.logo ?? null,
      twitter: input.twitter ?? null,
      priority: input.priority ?? 0,
      comments: input.comments ?? null,
      skillMdPath: input.skillMdPath ?? "SKILL.md",
    })
    .returning()

  if (!row) throw new Error(`Failed to create project ${input.slug}`)

  // Whether a repository is "curated" is derived from `projects`, so creating
  // the first project is what moves every submission of this repository from
  // `tracked` to `curated`. Recomputed here rather than at the call sites
  // because the call sites are three and the rule is one.
  await recomputePlatformStates(db, [input.repoId])

  return row
}

export async function getProjectById(
  db: Db,
  id: string
): Promise<ProjectWithRepo | undefined> {
  return db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: { repo: true },
  })
}

export async function getProjectBySlug(
  db: Db,
  slug: string
): Promise<ProjectWithRepo | undefined> {
  return db.query.projects.findFirst({
    where: eq(projects.slug, slug),
    with: { repo: true },
  })
}

export async function getProjectByFullName(
  db: Db,
  fullName: string
): Promise<ProjectWithRepo | undefined> {
  const [owner, name] = fullName.split("/")
  if (!owner || !name) return undefined
  return db.query.projects.findFirst({
    where: and(eq(projects.owner, owner), eq(projects.name, name)),
    with: { repo: true },
  })
}

export async function getProjectByRepoId(
  db: Db,
  repoId: string
): Promise<ProjectWithRepo | undefined> {
  return db.query.projects.findFirst({
    where: eq(projects.repoId, repoId),
    with: { repo: true },
  })
}

/**
 * Lists projects with their repository joined in.
 *
 * `includeHidden` is off by default because hidden projects are excluded
 * from every public listing; only the admin view passes `true`.
 */
export async function listProjects(
  db: Db,
  options: {
    includeHidden?: boolean
    type?: ProjectType
    limit?: number
    offset?: number
  } = {}
): Promise<ProjectWithRepo[]> {
  const conditions = []
  if (!options.includeHidden) {
    conditions.push(sql`${projects.status} <> 'hidden'`)
  }
  if (options.type) {
    conditions.push(eq(projects.type, options.type))
  }

  const rows = await db
    .select({ project: projects, repo: repos })
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(conditions.length > 0 ? sql`${and(...conditions)}` : undefined)
    .orderBy(desc(projects.priority), asc(projects.name))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0)

  return rows.map(({ project, repo }) => ({ ...project, repo }))
}

/**
 * Every project, paged through to the end.
 *
 * `listProjects` caps at 100 rows, which is the right default for a page of
 * results but silently wrong for a sync: a catalogue past the hundredth
 * project would have its tail skipped, and because the ordering is by
 * priority and then name, the projects dropped would be the same ones every
 * run rather than an arbitrary slice. Nothing would fail, so the omission
 * would only surface as a quietly incomplete site.
 */
export async function listAllProjects(
  db: Db,
  options: { includeHidden?: boolean; type?: ProjectType } = {}
): Promise<ProjectWithRepo[]> {
  const pageSize = 200
  const all: ProjectWithRepo[] = []

  for (let offset = 0; ; offset += pageSize) {
    const page = await listProjects(db, { ...options, limit: pageSize, offset })
    all.push(...page)
    if (page.length < pageSize) return all
  }
}

/**
 * Applies an editorial change.
 *
 * Passing `undefined` for a field leaves it unchanged, so a partial update
 * cannot blank a column. To clear one, pass `null` explicitly.
 */
export async function updateProject(
  db: Db,
  id: string,
  changes: Partial<{
    name: string
    slug: string
    description: string
    url: string | null
    status: ProjectStatus
    type: ProjectType
    logo: string | null
    twitter: string | null
    priority: number
    comments: string | null
    skillMdPath: string | null
    overrideDescription: boolean
    overrideUrl: boolean
  }>
): Promise<ProjectRow | undefined> {
  const [row] = await db
    .update(projects)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()
  return row
}

/**
 * Refreshes the fields a project inherits from its repository.
 *
 * The `overrideDescription` and `overrideUrl` flags exist so an edited
 * description or homepage survives later repository refreshes: an automatic
 * sync must not undo a human decision. The repository is read first and the
 * update is written with concrete values, so the decision is made in one
 * place rather than spread across a correlated subquery.
 */
export async function syncProjectFromRepo(db: Db, id: string): Promise<void> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: { repo: true },
  })
  if (!project) throw new Error(`Project not found: ${id}`)

  const changes: Partial<typeof projects.$inferInsert> = {
    updatedAt: new Date(),
  }

  if (!project.overrideDescription && project.repo.description) {
    changes.description = project.repo.description
  }
  if (!project.overrideUrl && project.repo.homepage) {
    changes.url = project.repo.homepage
  }

  await db.update(projects).set(changes).where(eq(projects.id, id))
}

export async function deleteProject(db: Db, id: string): Promise<void> {
  // Read before deleting: once the project is gone there is nothing left to join
  // `user_repos` on, and the submissions of this repository have to stop reading
  // as `curated` — the last project pointing at it is what made them read that
  // way.
  const [existing] = await db
    .select({ repoId: projects.repoId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1)

  await db.delete(projects).where(eq(projects.id, id))

  if (existing) {
    await recomputePlatformStates(db, [existing.repoId])
  }
}

export async function listProjectIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: projects.id }).from(projects)
  return rows.map((row) => row.id)
}

export async function getProjectsByIds(
  db: Db,
  ids: string[]
): Promise<ProjectWithRepo[]> {
  if (ids.length === 0) return []
  return db.query.projects.findMany({
    where: inArray(projects.id, ids),
    with: { repo: true },
  })
}


export async function listUnreviewedProjects(
  db: Db,
  options: { limit?: number } = {}
): Promise<
  Array<{
    id: string
    name: string
    owner: string
    description: string | null
    readme: string | null
    categoryId: string | null
    categoryConfidence: number | null
    categoryEvidence: string | null
  }>
> {
  const limit = options.limit ?? 50
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      description: projects.description,
      readme: repos.readmeContent,
      categoryId: projects.categoryId,
      categoryConfidence: projects.categoryConfidence,
      categoryEvidence: projects.categoryEvidence,
    })
    .from(projects)
    .leftJoin(repos, eq(repos.id, projects.repoId))
    .where(isNull(projects.categoryReviewedAt))
    .orderBy(sql`${projects.categoryConfidence} asc nulls last`, asc(projects.updatedAt))
    .limit(limit)
  return rows
}

