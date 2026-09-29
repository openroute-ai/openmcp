/**
 * Hall of fame, the site's author directory.
 *
 * An author is derived from the owner of a curated repository, so the GitHub
 * identity is known and only the display details need fetching.
 */

import { eq, sql, type SQL } from "drizzle-orm"
import { nanoid } from "nanoid"
import { hallOfFame, hallOfFameToProjects, projects } from "@/db/schema"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import type { UserInfo } from "@/lib/github/user-info-query"
import type { Db, RepoRow } from "@/lib/github/service/repo"

type HallOfFameRow = typeof hallOfFame.$inferSelect

/**
 * What an upsert's conflict branch may write.
 *
 * The same shape Drizzle accepts for a conflict update, derived from the table
 * rather than imported from an internal path: every column's own data type, or
 * a `SQL` expression for a value computed in the statement.
 */
type HallOfFameUpdateSet = {
  [K in keyof typeof hallOfFame.$inferInsert]?:
    | (typeof hallOfFame.$inferInsert)[K]
    | SQL
}

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

export function githubProfileUrl(username: string): string {
  return `https://github.com/${username}`
}

/**
 * Adds an author, or refreshes the fields derived from GitHub.
 *
 * Two kinds of display data arrive here and they are kept apart on purpose,
 * because they differ in authority:
 *
 * - `profile` is authoritative. It came from the account's own GitHub profile
 *   or from an operator editing the entry, so on conflict it overwrites.
 * - `defaults` is a guess derived from a repository — the login as a name, the
 *   owner's id for an avatar, the repository's own homepage. It fills a blank
 *   and nothing else, because a repository knows far less about an author than
 *   the author's profile does, and every project refresh runs this path. Letting
 *   it overwrite would mean a project sync silently reset a fetched display
 *   name back to the bare login, one full refresh after it was fetched.
 */
export async function upsertAuthor(
  db: Db,
  input: UpsertAuthorInput,
  profile?: Partial<AuthorProfile>,
  defaults?: Partial<AuthorProfile>
): Promise<void> {
  // The values an insert starts from, when the author is new and there is
  // nothing to preserve: a profile beats a repository-derived guess, and a
  // guess beats the bare login.
  const initial: AuthorProfile = {
    name: profile?.name ?? defaults?.name ?? input.username,
    followers: profile?.followers ?? null,
    bio: profile?.bio ?? null,
    homepage: profile?.homepage ?? null,
    twitter: profile?.twitter ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    linkedin: profile?.linkedin ?? null,
    npmUsername: profile?.npmUsername ?? null,
    npmPackageCount: profile?.npmPackageCount ?? null,
  }

  // Only the keys a profile actually carries are written on conflict, so a
  // caller that only knows one field does not blank the other eight. Written
  // field by field because a computed key over the row type is not narrow
  // enough for Drizzle's insert set.
  const profileSet: HallOfFameUpdateSet = {}
  if (profile?.name !== undefined) profileSet.name = profile.name
  if (profile?.followers !== undefined) profileSet.followers = profile.followers
  if (profile?.bio !== undefined) profileSet.bio = profile.bio
  if (profile?.homepage !== undefined) profileSet.homepage = profile.homepage
  if (profile?.twitter !== undefined) profileSet.twitter = profile.twitter
  if (profile?.linkedin !== undefined) profileSet.linkedin = profile.linkedin
  if (profile?.npmUsername !== undefined) {
    profileSet.npmUsername = profile.npmUsername
  }
  if (profile?.npmPackageCount !== undefined) {
    profileSet.npmPackageCount = profile.npmPackageCount
  }

  // A guess is written only where the author has nothing. `coalesce` over the
  // existing value is what makes this "fill the blank" rather than an
  // overwrite, and it is done in SQL so it holds for a concurrent refresh that
  // read the same blank a moment earlier. A null guess is skipped entirely:
  // `coalesce` would store it, defeating the point.
  const guessSet: HallOfFameUpdateSet = {}
  if (defaults?.name) {
    guessSet.name = sql`coalesce(${hallOfFame.name}, ${defaults.name})`
  }
  if (defaults?.homepage) {
    guessSet.homepage = sql`coalesce(${hallOfFame.homepage}, ${defaults.homepage})`
  }
  if (defaults?.avatarUrl) {
    guessSet.avatarUrl = sql`coalesce(${hallOfFame.avatarUrl}, ${defaults.avatarUrl})`
  }

  // The display fields are deliberately absent from the base set. Writing them
  // here would mean an update that carried one field — an operator editing a
  // LinkedIn handle — blanked the eight it did not carry. They arrive through
  // `profileSet` (authoritative) or `guessSet` (fill the blank) instead, and a
  // caller with neither leaves them exactly as they were.
  const set = {
    github: githubProfileUrl(input.username),
    ...(input.avatar ? { avatar: input.avatar } : {}),
    ...(input.verified !== undefined ? { verified: input.verified } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...guessSet,
    ...profileSet,
    updatedAt: new Date(),
  }

  await db
    .insert(hallOfFame)
    .values({
      username: input.username,
      name: initial.name,
      followers: initial.followers,
      bio: initial.bio,
      homepage: initial.homepage,
      twitter: initial.twitter,
      avatar: input.avatar ?? null,
      avatarUrl: initial.avatarUrl,
      linkedin: initial.linkedin,
      github: githubProfileUrl(input.username),
      verified: input.verified ?? false,
      metadata: input.metadata ?? null,
      npmUsername: initial.npmUsername,
      npmPackageCount: initial.npmPackageCount,
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
    undefined,
    {
      // The repository's homepage is the best home page available without a
      // separate profile fetch, and it is what the source app stored. Passed as
      // a default rather than a profile: it fills a blank homepage and is left
      // alone once a real profile fetch has written one.
      name: repo.owner,
      homepage: repo.homepage,
      avatarUrl: githubAvatarUrl(repo.owner, {
        // The column is an integer stored as text, so a non-numeric value fails
        // the id check inside the builder and the login is used instead.
        ownerId: Number(repo.ownerId),
        size: 100,
      }),
    }
  )
}

/**
 * Records the repository owner as an author and links them to the project.
 *
 * Best effort, and deliberately so: an author entry is a byline, and a publish
 * that failed on one would leave the project out of the directory for a
 * cosmetic reason. Returning a boolean rather than throwing lets the caller
 * collect it as a warning and finish the rest of the work.
 *
 * Shared by project creation and project refresh so the two cannot drift: they
 * write the same rows for the same reason, and only the caller's log prefix
 * differed.
 */
export async function linkAuthorToProjectFromRepo(
  db: Db,
  repo: RepoRow,
  projectId: string
): Promise<boolean> {
  try {
    await upsertAuthorFromRepo(db, {
      owner: repo.owner,
      ownerId: String(repo.ownerId),
      homepage: repo.homepage,
    })
    await linkAuthorToProject(db, repo.owner, projectId)
    return true
  } catch (error) {
    console.warn("[hall-of-fame] could not record the author", error)
    return false
  }
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

/**
 * Fills an author row from their GitHub profile.
 *
 * The columns existed and were selected, but nothing ever wrote them: an author
 * row was created from a repository, which knows the login and nothing else, so
 * `followers`, `bio` and the rest stayed null and the author card could only
 * ever show a handle. This is the call that makes them real.
 *
 * Best effort and non-destructive. A profile is a byline, so a failed or
 * rate-limited fetch must not fail the publish that triggered it, and it must
 * not blank fields it could not read: an empty bio on GitHub is written as
 * null, but a fetch that never ran writes nothing at all. `linkedin` and the
 * npm fields are not part of GitHub's profile and are left alone — they are
 * whatever an operator put there.
 */
export async function refreshAuthorProfile(
  db: Db,
  username: string,
  deps: { client?: Pick<GitHubClient, "fetchUserInfo"> } = {}
): Promise<
  { ok: true; author: HallOfFameRow } | { ok: false; error: string }
> {
  const existing = await getAuthor(db, username)
  if (!existing) {
    return { ok: false, error: `author ${username} is not recorded` }
  }

  const client = deps.client ?? createGitHubClient()

  let info: UserInfo
  try {
    info = await client.fetchUserInfo(username)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  await upsertAuthor(
    db,
    { username, verified: existing.verified, status: existing.status },
    {
      name: info.name || username,
      followers: info.followers,
      bio: info.bio || null,
      homepage: info.websiteUrl || null,
      avatarUrl: info.avatarUrl || null,
      twitter: info.twitter || null,
    }
  )

  const author = await getAuthor(db, username)
  return { ok: true, author: author ?? existing }
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
export async function listVerifiedAuthors(
  db: Db
): Promise<AuthorWithProjects[]> {
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

  return [...byUsername.values()].sort(
    (a, b) => (b.followers ?? 0) - (a.followers ?? 0)
  )
}

export async function listAuthorsForProject(
  db: Db,
  projectId: string
): Promise<HallOfFameRow[]> {
  const rows = await db
    .select({ author: hallOfFame })
    .from(hallOfFameToProjects)
    .innerJoin(
      hallOfFame,
      eq(hallOfFame.username, hallOfFameToProjects.username)
    )
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
