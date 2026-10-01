import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { projects, repos } from "@/db/schema"
import type { Database, Tx } from "@/db/client"
import type { RepoInfo } from "@/lib/github/repo-info-query"

/** Any drizzle executor, so callers can pass a transaction. */
export type Db = Database | Tx

/** Exported so callers can name a stored repository without re-deriving it. */
export type RepoRow = typeof repos.$inferSelect
type RepoInsert = typeof repos.$inferInsert

/**
 * Counters that are only overwritten when the incoming value is non-zero.
 *
 * The client has a three-tier fallback, and the lower two tiers return a
 * `RepoInfo` whose expensive connections were never read, so their counters
 * are legitimately zero rather than actually zero. Writing those zeros over
 * accurate stored values would silently destroy good data on exactly the
 * tokens that can least afford to re-fetch it. A counter that genuinely
 * falls to zero carries no ranking signal, so it is left as it is.
 *
 * `contributorCount` is deliberately absent: it is not part of `RepoInfo` at
 * all, because it comes from its own REST call. See `setContributorCount`.
 */
const NON_ZERO_ONLY_COUNTERS = [
  "stars",
  "forks",
  "watchersCount",
  "mentionableUsersCount",
  "pullRequestsCount",
  "releasesCount",
  "commitCount",
] as const satisfies readonly (keyof RepoInfo & keyof RepoInsert)[]

/**
 * Builds the insert payload for a repository.
 *
 * Exported for testing: the zero-counter and no-clobber rules below are the
 * difference between a refresh that is safe and one that quietly destroys
 * stored data, so they are asserted directly rather than only through a
 * database round-trip.
 */
export function toRepoRow(info: RepoInfo): RepoInsert {
  return {
    id: nanoid(),
    name: info.name,
    owner: info.owner,
    ownerId: info.ownerId,
    stars: info.stars,
    forks: info.forks,
    watchersCount: info.watchersCount,
    topics: info.topics,
    archived: info.archived,
    description: info.description,
    homepage: info.homepage,
    defaultBranch: info.defaultBranch,
    licenseSpdxId: info.licenseSpdxId,
    languages: info.languages,
    pushedAt: info.pushedAt,
    createdAt: info.createdAt,
    lastCommit: info.lastCommit,
    commitCount: info.commitCount,
    mentionableUsersCount: info.mentionableUsersCount,
    pullRequestsCount: info.pullRequestsCount,
    releasesCount: info.releasesCount,
    openGraphImageUrl: info.openGraphImageUrl,
    usesCustomOpenGraphImage: info.usesCustomOpenGraphImage,
    latestReleaseName: info.latestReleaseName,
    latestReleaseTagName: info.latestReleaseTagName,
    latestReleasePublishedAt: info.latestReleasePublishedAt,
    latestReleaseUrl: info.latestReleaseUrl,
    latestReleaseDescription: info.latestReleaseDescription,
    updatedAt: new Date(),
  }
}

/**
 * Builds the update payload for a repository that already exists.
 *
 * Only GitHub-derived fields are touched. The README, its translation, the
 * icon and the OSS image URLs are written by their own tasks, and are
 * deliberately absent here so a routine stats refresh cannot wipe them.
 *
 * `overrides` names the fields a human has already edited. GitHub is the
 * source of truth for the rest, but not for those: the daily sweep runs this
 * for every repository on a schedule, so an editor's description would survive
 * only until the next pass. A caller that does not know the flags passes
 * nothing and gets the plain GitHub-derived behaviour, which is what the
 * repository sweep does.
 */
export function toRepoUpdate(
  info: RepoInfo,
  overrides: { description?: boolean; homepage?: boolean } = {}
): Partial<RepoInsert> {
  const update: Partial<RepoInsert> = {
    name: info.name,
    ownerId: info.ownerId,
    topics: info.topics,
    archived: info.archived,
    defaultBranch: info.defaultBranch,
    licenseSpdxId: info.licenseSpdxId,
    languages: info.languages,
    pushedAt: info.pushedAt,
    createdAt: info.createdAt,
    lastCommit: info.lastCommit,
    openGraphImageUrl: info.openGraphImageUrl,
    usesCustomOpenGraphImage: info.usesCustomOpenGraphImage,
    latestReleaseName: info.latestReleaseName,
    latestReleaseTagName: info.latestReleaseTagName,
    latestReleasePublishedAt: info.latestReleasePublishedAt,
    latestReleaseUrl: info.latestReleaseUrl,
    latestReleaseDescription: info.latestReleaseDescription,
    updatedAt: new Date(),
  }

  if (!overrides.description) update.description = info.description
  if (!overrides.homepage) update.homepage = info.homepage

  for (const column of NON_ZERO_ONLY_COUNTERS) {
    const value = info[column]
    if (value > 0) {
      update[column] = value
    }
  }

  return update
}

/**
 * Inserts or updates a repository, keyed on `(owner, name)`.
 *
 * `addedAt` is left to its column default so it records when this system
 * first saw the repository and is never moved by a later refresh.
 *
 * The override flags are read from the row that is already there rather than
 * taken as an argument, because they are a property of the stored record and
 * every writer needs the same answer. A caller that genuinely wants to discard
 * an override clears the flag first through {@link curateRepo}.
 */
export async function upsertRepo(db: Db, info: RepoInfo): Promise<RepoRow> {
  const [existing] = await db
    .select({
      description: repos.overrideDescription,
      homepage: repos.overrideHomepage,
    })
    .from(repos)
    .where(and(eq(repos.owner, info.owner), eq(repos.name, info.name)))
    .limit(1)

  const [row] = await db
    .insert(repos)
    .values(toRepoRow(info))
    .onConflictDoUpdate({
      target: [repos.owner, repos.name],
      set: toRepoUpdate(info, {
        description: existing?.description === true,
        homepage: existing?.homepage === true,
      }),
    })
    .returning()

  if (!row) {
    throw new Error(`Failed to upsert repository ${info.fullName}`)
  }
  return row
}

/**
 * Records which account added a repository through `/console`.
 *
 * Kept out of {@link upsertRepo} rather than threaded through it, because
 * ownership is a property of the *click*, not of the GitHub data the upsert is
 * about: a refresh must never move it, and the discovery sweep and project
 * creation have no account to give. The one decision that does belong to the
 * caller — whether an existing, unowned row may be claimed — stays in
 * `repos.create`, so no other writer can set ownership by accident.
 */
export async function setRepoCreatedBy(
  db: Db,
  id: string,
  createdBy: string
): Promise<void> {
  await db.update(repos).set({ createdBy }).where(eq(repos.id, id))
}

/** The repository fields an operator may edit by hand. */
export interface RepoCuration {
  description?: string | null
  descriptionZh?: string | null
  homepage?: string | null
  iconUrl?: string | null
  /**
   * Set `false` to hand a field back to GitHub.
   *
   * This is the only way to detach a field from a refresh once it has been
   * overridden: the flag is what tells {@link toRepoUpdate} to leave the value
   * alone, so clearing the flag is what makes the next sweep overwrite it.
   */
  overrideDescription?: boolean
  overrideHomepage?: boolean
}

/**
 * Writes the hand-edited fields of a repository.
 *
 * A value is written only when it actually differs from what is stored, and
 * the override flag is raised only alongside a changed value. An operator who
 * opens the editor and saves without touching a field should not silently
 * detach that field from GitHub forever, and comparing against the stored row
 * is what makes that true regardless of how the editor submits its form. A
 * partial edit stays partial: a field passed as `undefined` is not written.
 *
 * `description` and `homepage` are the only two that are GitHub's to begin with.
 * The other two are ours already — a machine translation and a mirrored icon —
 * so there is nothing for a refresh to undo and no flag for them.
 */
export async function curateRepo(
  db: Db,
  id: string,
  fields: RepoCuration
): Promise<RepoRow | undefined> {
  const [existing] = await db
    .select({
      description: repos.description,
      descriptionZh: repos.descriptionZh,
      homepage: repos.homepage,
      iconUrl: repos.iconUrl,
      overrideDescription: repos.overrideDescription,
      overrideHomepage: repos.overrideHomepage,
    })
    .from(repos)
    .where(eq(repos.id, id))
    .limit(1)

  if (!existing) return undefined

  const set: Partial<RepoInsert> = {}

  // Only a value that differs is written, and the flag travels with that write
  // rather than with the form, so an untouched field is never marked.
  for (const key of [
    "description",
    "descriptionZh",
    "homepage",
    "iconUrl",
  ] as const) {
    const value = fields[key]
    if (value === undefined) continue
    if (value === existing[key]) continue
    set[key] = value
    if (key === "description") set.overrideDescription = true
    if (key === "homepage") set.overrideHomepage = true
  }

  // Handing a field back to GitHub is a flag change on its own, with no value:
  // the next refresh supplies the value from GitHub and clears nothing.
  if (fields.overrideDescription === false) set.overrideDescription = false
  if (fields.overrideHomepage === false) set.overrideHomepage = false

  if (Object.keys(set).length === 0) return getRepoById(db, id)

  set.updatedAt = new Date()

  const [row] = await db
    .update(repos)
    .set(set)
    .where(eq(repos.id, id))
    .returning()
  return row
}

export async function getRepoById(
  db: Db,
  id: string
): Promise<RepoRow | undefined> {
  return db.query.repos.findFirst({ where: eq(repos.id, id) })
}

export async function getRepoByFullName(
  db: Db,
  fullName: string
): Promise<RepoRow | undefined> {
  const [owner, name] = fullName.split("/")
  if (!owner || !name) return undefined
  return db.query.repos.findFirst({
    where: and(eq(repos.owner, owner), eq(repos.name, name)),
  })
}

/**
 * Looks up many repositories at once, keyed by `owner/name` so the caller
 * does not have to correlate results with its input order.
 */
export async function getReposByFullNames(
  db: Db,
  fullNames: string[]
): Promise<Map<string, RepoRow>> {
  const byFullName = new Map<string, RepoRow>()
  if (fullNames.length === 0) return byFullName

  const owners = new Set<string>()
  const names = new Set<string>()
  for (const fullName of fullNames) {
    const [owner, name] = fullName.split("/")
    if (owner && name) {
      owners.add(owner)
      names.add(name)
    }
  }

  const rows = await db
    .select()
    .from(repos)
    .where(inArray(repos.owner, [...owners]))

  for (const row of rows) {
    if (names.has(row.name)) byFullName.set(`${row.owner}/${row.name}`, row)
  }
  return byFullName
}

export async function listRepoIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: repos.id }).from(repos)
  return rows.map((row) => row.id)
}

/**
 * Every stored repository, for a sweep.
 *
 * A sweep needs the full rows, not just ids: the batched refresh has to know
 * each repository's default branch to fetch the right README, and the ids
 * alone would force a second query per repository.
 */
export async function listAllRepos(db: Db): Promise<RepoRow[]> {
  return db.select().from(repos).orderBy(repos.addedAt)
}

/**
 * Every stored repository an administrator has curated, meaning one with at
 * least one project pointing at it.
 *
 * The distinction this exists to draw is between a repository that has been
 * *collected* and one that has been *published*. Both are stored, and both are
 * kept current in their metadata, but only a curated one is a project: it is
 * what the sweep deep-refreshes, what the project list is built from, and what
 * an author's page counts. A repository nobody has curated is a candidate — the
 * scheduled sweep still fetches it, so the list a user sees is current, but
 * nothing is derived from it.
 *
 * An inner join, so a repository with no project is not in the result at all
 * rather than present with an empty project list: callers here want the
 * "publishes something" subset, and the cheaper query is the same one the
 * absence test needs.
 */
export async function listCuratedRepos(db: Db): Promise<RepoRow[]> {
  const rows = await db
    .select({ repo: repos, projectId: projects.id })
    .from(repos)
    .innerJoin(projects, eq(projects.repoId, repos.id))
    .orderBy(repos.addedAt)

  // Deduped here rather than with `selectDistinct`, matching how
  // `listReposByOwner` handles the same join: `repos.id` is the primary key, so
  // the duplicates are exact copies, and the first of them keeps the row.
  const seen = new Set<string>()
  const curated: RepoRow[] = []
  for (const row of rows) {
    if (seen.has(row.repo.id)) continue
    seen.add(row.repo.id)
    curated.push(row.repo)
  }
  return curated
}

export interface OwnerRepos {
  owner: string
  ownerId: number
  homepage: string | null
  repos: { id: string; projectIds: string[] }[]
}

/**
 * Repositories grouped by their owner login, for hall-of-fame linking.
 *
 * Projects are attached to their repository rather than the owner, so a
 * repository with several curated projects contributes all of them and the
 * author's page is the union across their repositories.
 *
 * An inner join, and that is the point of the function rather than a detail of
 * it: an author page is derived from published projects, so an owner whose only
 * repositories are uncollected candidates has nothing to be listed under. A
 * left join would hand the sweep an author per candidate owner, each with an
 * empty project set, and those rows are what an authors directory reads.
 */
export async function listReposByOwner(db: Db): Promise<OwnerRepos[]> {
  const rows = await db
    .select({ repo: repos, projectId: projects.id })
    .from(repos)
    .innerJoin(projects, eq(projects.repoId, repos.id))
    .orderBy(repos.owner, repos.addedAt)

  const byOwner = new Map<string, OwnerRepos>()

  for (const row of rows) {
    let entry = byOwner.get(row.repo.owner)

    if (!entry) {
      entry = {
        owner: row.repo.owner,
        ownerId: row.repo.ownerId,
        homepage: row.repo.homepage,
        repos: [],
      }
      byOwner.set(row.repo.owner, entry)
    }

    // The join emits one row per project, so a repository seen before needs its
    // project set extended rather than pushed again.
    const repo = entry.repos.find((candidate) => candidate.id === row.repo.id)
    if (repo) {
      repo.projectIds.push(row.projectId)
    } else {
      entry.repos.push({ id: row.repo.id, projectIds: [row.projectId] })
    }
  }

  return [...byOwner.values()]
}

/**
 * Records contributor count, which comes from a separate REST call so the
 * GitHub metadata refresh does not have to make it.
 */
export async function setContributorCount(
  db: Db,
  id: string,
  contributorCount: number
): Promise<void> {
  await db.update(repos).set({ contributorCount }).where(eq(repos.id, id))
}

/** Stores the processed README for a repository. */
export async function setReadme(
  db: Db,
  id: string,
  readmeContent: string
): Promise<void> {
  await db
    .update(repos)
    .set({ readmeContent, updatedAt: new Date() })
    .where(eq(repos.id, id))
}

/**
 * Stores the Chinese translations. Kept separate from `setReadme` because
 * translation is a separate task that runs less often and can fail on its
 * own without invalidating the source README.
 */
export async function setTranslations(
  db: Db,
  id: string,
  translations: {
    readmeContentZh?: string
    descriptionZh?: string
    latestReleaseDescriptionZh?: string
  }
): Promise<void> {
  await db
    .update(repos)
    .set({ ...translations, updatedAt: new Date() })
    .where(eq(repos.id, id))
}

export async function setIconUrls(
  db: Db,
  id: string,
  urls: { iconUrl?: string; openGraphImageOssUrl?: string }
): Promise<void> {
  await db
    .update(repos)
    .set({ ...urls, updatedAt: new Date() })
    .where(eq(repos.id, id))
}
