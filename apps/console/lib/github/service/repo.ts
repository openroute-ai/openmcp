import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { projects, repos } from "@/db/schema"
import type { Database, Tx } from "@/db/client"
import type { RepoInfo } from "@/lib/github/repo-info-query"

/** Any drizzle executor, so callers can pass a transaction. */
export type Db = Database | Tx

type RepoRow = typeof repos.$inferSelect
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
 */
export function toRepoUpdate(info: RepoInfo): Partial<RepoInsert> {
  const update: Partial<RepoInsert> = {
    name: info.name,
    ownerId: info.ownerId,
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
    openGraphImageUrl: info.openGraphImageUrl,
    usesCustomOpenGraphImage: info.usesCustomOpenGraphImage,
    latestReleaseName: info.latestReleaseName,
    latestReleaseTagName: info.latestReleaseTagName,
    latestReleasePublishedAt: info.latestReleasePublishedAt,
    latestReleaseUrl: info.latestReleaseUrl,
    latestReleaseDescription: info.latestReleaseDescription,
    updatedAt: new Date(),
  }

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
 */
export async function upsertRepo(db: Db, info: RepoInfo): Promise<RepoRow> {
  const [row] = await db
    .insert(repos)
    .values(toRepoRow(info))
    .onConflictDoUpdate({
      target: [repos.owner, repos.name],
      set: toRepoUpdate(info),
    })
    .returning()

  if (!row) {
    throw new Error(`Failed to upsert repository ${info.fullName}`)
  }
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
 */
export async function listReposByOwner(db: Db): Promise<OwnerRepos[]> {
  const rows = await db
    .select({ repo: repos, projectId: projects.id })
    .from(repos)
    .leftJoin(projects, eq(projects.repoId, repos.id))
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

    const repo = entry.repos.find((candidate) => candidate.id === row.repo.id)
    if (!repo) {
      entry.repos.push({ id: row.repo.id, projectIds: [] })
    }

    // The join emits one row per project, and a project with no id here is a
    // repository that is not curated at all.
    if (row.projectId) {
      entry.repos.find((candidate) => candidate.id === row.repo.id)?.projectIds.push(
        row.projectId
      )
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
  await db
    .update(repos)
    .set({ contributorCount })
    .where(eq(repos.id, id))
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
