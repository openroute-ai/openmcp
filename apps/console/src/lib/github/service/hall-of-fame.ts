/**
 * Hall of fame, the site's author directory.
 *
 * An author is derived from the owner of a curated repository, so the GitHub
 * identity is known and only the display details need fetching.
 */

import { eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  hallOfFame,
  hallOfFameToProjects,
  projects,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

type HallOfFameRow = typeof hallOfFame.$inferSelect

export interface AuthorProfile {
  name: string
  followers: number | null
  bio: string | null
  homepage: string | null
  twitter: string | null
  avatarUrl: string | null
  linkedin: string | null
  npmUsername: string | null
  npmPackageCount: number | null
}

export interface UpsertAuthorInput {
  username: string
  /** Where the avatar was mirrored, absent when mirroring is unavailable. */
  avatar?: string | null
  verified?: boolean
  metadata?: Record<string, unknown> | null
  status?: "active" | "inactive" | "archived"
}

/** GitHub serves an avatar for a numeric user id even when the login changed. */
export function githubAvatarUrl(ownerId: string | number | null): string | null {
  if (ownerId === null || ownerId === undefined || ownerId === "") return null
  return `https://avatars.githubusercontent.com/u/${ownerId}?v=3&s=100`
}

export function githubProfileUrl(username: string): string {
  return `https://github.com/${username}`
}

/**
 * Adds an author, or refreshes the fields derived from GitHub.
 *
 * Only the derived fields are overwritten on conflict. `followers`, `bio`,
 * and the npm details are fetched separately and are curated, so a
 * repository sync must not reset them to null.
 */
export async function upsertAuthor(
  db: Db,
  input: UpsertAuthorInput,
  profile?: Partial<AuthorProfile>
): Promise<void> {
  const avatarUrl = profile?.avatarUrl ?? null
  const homepage = profile?.homepage ?? null

  const set = {
    name: input.username,
    github: githubProfileUrl(input.username),
    avatarUrl,
    homepage,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    ...(input.verified !== undefined ? { verified: input.verified } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: new Date(),
  }

  await db
    .insert(hallOfFame)
    .values({
      username: input.username,
      name: profile?.name ?? input.username,
      followers: profile?.followers ?? null,
      bio: profile?.bio ?? null,
      homepage,
      twitter: profile?.twitter ?? null,
      avatar: input.avatar ?? null,
      avatarUrl,
      linkedin: profile?.linkedin ?? null,
      github: githubProfileUrl(input.username),
      verified: input.verified ?? false,
      metadata: input.metadata ?? null,
      npmUsername: profile?.npmUsername ?? null,
      npmPackageCount: profile?.npmPackageCount ?? null,
      status: input.status ?? "active",
    })
    .onConflictDoUpdate({ target: hallOfFame.username, set })
}

/**
 * Records an author found as the owner of a repository.
 *
 * The repository owner is a GitHub identity rather than a chosen display
 * name, so the login doubles as the name until a profile says otherwise.
 */
export async function upsertAuthorFromRepo(
  db: Db,
  repo: { owner: string; ownerId: string | null; homepage: string | null }
): Promise<void> {
  if (!repo.owner) return

  await upsertAuthor(
    db,
    { username: repo.owner, avatar: null, verified: false },
    {
      // The repository's homepage is the best home page available without a
      // separate profile fetch, and it is what the source app stored.
      homepage: repo.homepage,
      avatarUrl: githubAvatarUrl(repo.ownerId),
    }
  )
}

export async function linkAuthorToProject(
  db: Db,
  username: string,
  projectId: string
): Promise<void> {
  await db
    .insert(hallOfFameToProjects)
    .values({ username, projectId })
    .onConflictDoNothing()
}

/**
 * Replaces an author's projects.
 *
 * A whole set is written rather than appended to, because the link set is
 * derived from a repository's curated projects and would otherwise keep
 * accumulating entries for projects that have since been removed.
 */
export async function setAuthorProjects(
  db: Db,
  username: string,
  projectIds: string[]
): Promise<void> {
  const unique = [...new Set(projectIds)]

  await db.transaction(async (tx) => {
    await tx
      .delete(hallOfFameToProjects)
      .where(eq(hallOfFameToProjects.username, username))

    if (unique.length === 0) return

    await tx
      .insert(hallOfFameToProjects)
      .values(unique.map((projectId) => ({ username, projectId })))
  })
}

export async function getAuthor(
  db: Db,
  username: string
): Promise<HallOfFameRow | undefined> {
  return db.query.hallOfFame.findFirst({
    where: eq(hallOfFame.username, username),
  })
}

export async function listAuthors(db: Db): Promise<HallOfFameRow[]> {
  return db.select().from(hallOfFame).orderBy(hallOfFame.username)
}

export interface AuthorWithProjects extends HallOfFameRow {
  projects: Array<typeof projects.$inferSelect>
}

/**
 * The authors that should be shown, most-followed first.
 *
 * Unverified authors are excluded: the directory is a curated list, and
 * showing every repository owner would bury the curated entries.
 */
export async function listVerifiedAuthors(db: Db): Promise<AuthorWithProjects[]> {
  const rows = await db
    .select({ author: hallOfFame, project: projects })
    .from(hallOfFame)
    .leftJoin(
      hallOfFameToProjects,
      eq(hallOfFameToProjects.username, hallOfFame.username)
    )
    .leftJoin(projects, eq(projects.id, hallOfFameToProjects.projectId))
    .where(eq(hallOfFame.verified, true))

  const byUsername = new Map<string, AuthorWithProjects>()

  for (const row of rows) {
    const existing = byUsername.get(row.author.username) ?? {
      ...row.author,
      projects: [],
    }
    // A project can be absent when the link exists but the project row was
    // removed; skipping keeps the author rather than adding an undefined.
    if (row.project) existing.projects.push(row.project)
    byUsername.set(row.author.username, existing)
  }

  return [...byUsername.values()].sort((a, b) =>
    (b.followers ?? 0) - (a.followers ?? 0)
  )
}

export async function listAuthorsForProject(
  db: Db,
  projectId: string
): Promise<HallOfFameRow[]> {
  const rows = await db
    .select({ author: hallOfFame })
    .from(hallOfFameToProjects)
    .innerJoin(hallOfFame, eq(hallOfFame.username, hallOfFameToProjects.username))
    .where(eq(hallOfFameToProjects.projectId, projectId))

  return rows.map((row) => row.author)
}

/** Adds an author by id, for an editorial flow. */
export async function createAuthor(
  db: Db,
  input: UpsertAuthorInput & { id?: string }
): Promise<string> {
  const id = input.id ?? nanoid()
  await upsertAuthor(db, input)
  return id
}

export async function countAuthors(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hallOfFame)
  return row?.count ?? 0
}

export async function listAuthorUsernames(
  db: Db,
  status?: "active" | "inactive" | "archived"
): Promise<string[]> {
  const rows = await db
    .select({ username: hallOfFame.username })
    .from(hallOfFame)
    .where(status ? eq(hallOfFame.status, status) : undefined)

  return rows.map((row) => row.username)
}

export type { HallOfFameRow }
