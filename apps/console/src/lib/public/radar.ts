/**
 * Reads for the public radar pages: rankings, categories, project detail.
 *
 * Everything here is anonymous-readable, so the rule the whole module exists to
 * keep is that it selects fields deliberately rather than spreading a row. A
 * signed-in page can return a project's internals because the reader already
 * proved they may see them; these pages are linked from anywhere, and
 * `projects.comments` in particular is an internal curation note that has no
 * business being served to a crawler.
 *
 * So: no session, no account data, and `hidden` projects excluded everywhere.
 * A hidden project is excluded rather than returned-with-a-flag because a
 * 200 that says "this exists but you may not see it" still confirms it exists.
 */

import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { hallOfFame, projects, projectsToTags, repos, tags } from "@/db/schema"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import type { Db } from "@/lib/github/service/repo"
import {
  listDailyArrivals,
  listWeeklyArrivals,
  type DailyArrivals,
  type WeeklyArrivals,
} from "@/lib/github/service/stats"

/**
 * Statuses that stay off the public pages.
 *
 * Only `hidden`. `deprecated` is deliberately public: a project being wound
 * down is exactly the signal the radar exists to publish, and hiding it would
 * leave the most interesting rows as 404s. The remaining three are ordinary
 * published states.
 */
const PUBLIC_WHERE = ne(projects.status, "hidden")

export interface PublicTag {
  code: string
  name: string
  description: string | null
  /** Projects carrying this tag, hidden ones already excluded. */
  projectCount: number
}

/**
 * Tags usable as category navigation, most-used first.
 *
 * Excludes tags an editor marked `exclude_from_rankings`, which are the
 * operational labels (`meta`, `wildcard`, `learning`) rather than descriptions
 * of the project. They are curation vocabulary, and putting them in a public nav
 * would advertise the back office.
 *
 * Ties break on the code so the order is stable across requests; a category nav
 * that reshuffles on every render is unreadable and impossible to link to.
 */
export async function listPublicTags(db: Db): Promise<PublicTag[]> {
  const rows = await db
    .select({
      code: tags.code,
      name: tags.name,
      description: tags.description,
      projectCount: sql<number>`count(${projectsToTags.projectId})::int`,
    })
    .from(tags)
    .innerJoin(projectsToTags, eq(projectsToTags.tagId, tags.id))
    .innerJoin(projects, eq(projectsToTags.projectId, projects.id))
    .where(and(eq(tags.excludeFromRankings, false), PUBLIC_WHERE))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${projectsToTags.projectId})`), tags.code)

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    projectCount: Number(row.projectCount),
  }))
}

export interface PublicProjectSummary {
  id: string
  name: string
  owner: string
  fullName: string
  description: string
  stars: number
  type: string
  status: string
  tags: string[]
  /**
   * Marks for the project's row, in the order they should be preferred.
   *
   * Every public list shows a project's mark, and a list of bare names is hard
   * to scan past a wall of `acme/thing` — the logo is what makes a list readable
   * as projects rather than as strings. Null on all three is normal and falls
   * back to the project's initials.
   */
  logo: string | null
  /** The repository icon the sync mirrored, the last mark before the initials. */
  iconUrl: string | null
  /** The owner's GitHub avatar, between the logo and the repository icon. */
  avatar: string | null
}

const SUMMARY_COLUMNS = {
  id: projects.id,
  name: projects.name,
  owner: projects.owner,
  description: projects.description,
  stars: repos.stars,
  type: projects.type,
  status: projects.status,
  logo: projects.logo,
  iconUrl: repos.iconUrl,
  ownerId: repos.ownerId,
}

/**
 * The owner avatar for a summary row, or null when the owner is not a login.
 *
 * Derived here rather than stored: every caller of `ProjectLogo` already builds
 * this URL the same way, and a stored copy would go stale the moment somebody
 * changed their GitHub profile picture.
 */
function avatarOf(row: { owner: string; ownerId: number }): string | null {
  return githubAvatarUrl(row.owner, { ownerId: row.ownerId })
}

/** `owner/name`, which is what a reader recognises and what GitHub uses. */
function fullNameOf(row: { owner: string; name: string }): string {
  return `${row.owner}/${row.name}`
}

/**
 * The tags of every project in `rows`, keyed by project id.
 *
 * One query for the whole page rather than one per project: a category can hold
 * fifty projects, and fifty round trips on an anonymous request is the fastest
 * way to get a public page rate-limited.
 */
async function tagsByProject(
  db: Db,
  projectIds: string[]
): Promise<Map<string, string[]>> {
  const byProject = new Map<string, string[]>()
  if (projectIds.length === 0) return byProject

  const rows = await db
    .select({
      projectId: projectsToTags.projectId,
      code: tags.code,
    })
    .from(projectsToTags)
    .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(
      and(
        // `inArray`, not a hand-written `= any($1)`: passing the array as one
        // bound parameter makes Drizzle expand it into a row constructor
        // (`= any(($1, $2, $3))`), which is a syntax error rather than a match.
        inArray(projectsToTags.projectId, projectIds),
        eq(tags.excludeFromRankings, false)
      )
    )

  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? []
    list.push(row.code)
    byProject.set(row.projectId, list)
  }
  return byProject
}

/**
 * Every public project carrying a tag, most-starred first.
 *
 * Projects with no recorded star count sort last rather than first: `stars` is
 * nullable, and a Postgres `DESC` puts nulls first, which would top the page
 * with rows that simply have not been measured.
 */
export async function listPublicProjectsByTag(
  db: Db,
  code: string
): Promise<PublicProjectSummary[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .innerJoin(projectsToTags, eq(projectsToTags.projectId, projects.id))
    .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(and(eq(tags.code, code), PUBLIC_WHERE))
    // `desc(...)` wraps the whole fragment, so `nulls last` has to sit inside
    // it — `ORDER BY x NULLS LAST DESC` is a syntax error, and the direction has
    // to be the last keyword Postgres sees.
    .orderBy(sql`${repos.stars} desc nulls last`, projects.name)

  const byProject = await tagsByProject(
    db,
    rows.map((row) => row.id)
  )

  return rows.map((row) => ({
    ...row,
    stars: row.stars ?? 0,
    fullName: fullNameOf(row),
    tags: byProject.get(row.id) ?? [],
    avatar: avatarOf(row),
  }))
}

export interface PublicProjectDetail extends PublicProjectSummary {
  url: string | null
  logo: string | null
  language: string | null
  license: string | null
  pushedAt: Date
  createdAt: Date
  /** The repository row, not the project row. The radar reads `repos` tables. */
  repoId: string
  /**
   * The latest release's publish time, or null when the project has never
   * released.
   *
   * Separate from `releases` (a count) because "eight releases" and "the last
   * one was 14 months ago" are different facts, and only the second one drives
   * the release-stall rule.
   */
  latestReleasePublishedAt: Date | null
  forks: number
  contributors: number | null
  releases: number
  /** The upstream README, or null when it was never synced. */
  readme: string | null
  /** The translated README, or null when nothing has been translated. */
  readmeZh: string | null
  /** Per-day arrivals, ascending, quiet days already filled as zero. */
  days: DailyArrivals[]
  /** Per-ISO-week arrivals, ascending. */
  weeks: WeeklyArrivals[]
}

/**
 * An author as the public pages show them.
 *
 * A byline rather than an account: this is what the author directory records
 * about the person behind a repository, and none of it is anything a signed-in
 * user can edit from the public site. `username` doubles as the GitHub login,
 * which is why the avatar and the profile link can be derived from it rather than
 * trusted from a stored URL.
 */
export interface PublicAuthor {
  username: string
  name: string
  bio: string | null
  /**
   * The mirrored copy, preferred because it is ours to serve; `avatarUrl` is the
   * upstream GitHub URL and the fallback for an author whose mirror never ran.
   */
  avatar: string | null
  avatarUrl: string | null
  /** Followers at the last profile refresh, or null when never refreshed. */
  followers: number | null
  verified: boolean
  homepage: string | null
  twitter: string | null
  linkedin: string | null
  npmUsername: string | null
}

/**
 * One project's public detail, or `undefined` when there is nothing to show.
 *
 * Addressed by owner and name rather than by `projects.id`, because the public
 * URL is meant to be readable and shareable — `/projects/acme/k8s-operator`
 * instead of an opaque slug — and the pair is already unique in the schema.
 *
 * `undefined` covers three cases that are all the same answer for a reader: an
 * owner/name that does not exist, a repository with no project, and a project an
 * editor marked hidden. The page turns all three into the same 404 rather than
 * distinguishing them, because the distinction is exactly what a probe wants.
 */
export async function getPublicProjectDetail(
  db: Db,
  owner: string,
  name: string
): Promise<PublicProjectDetail | undefined> {
  const rows = await db
    .select({
      ...SUMMARY_COLUMNS,
      url: projects.url,
      logo: projects.logo,
      // The whole array, not just the first entry: pulling element 0 out in SQL
      // needs a set-returning function inside a scalar subquery, which is
      // either an `->>` on a text result or a `limit` inside a subquery that may
      // return several rows. Both are more fragile than reading one column and
      // taking `[0]` here. GitHub orders the map by bytes, so index 0 is the
      // dominant language.
      languages: repos.languages,
      license: repos.licenseSpdxId,
      pushedAt: repos.pushedAt,
      createdAt: repos.createdAt,
      forks: repos.forks,
      contributors: repos.contributorCount,
      releases: repos.releasesCount,
      readme: repos.readmeContent,
      readmeZh: repos.readmeContentZh,
      repoId: repos.id,
      latestReleasePublishedAt: repos.latestReleasePublishedAt,
    })
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(
      and(eq(projects.owner, owner), eq(projects.name, name), PUBLIC_WHERE)
    )

  const row = rows[0]
  if (!row) return undefined

  const [byProject, days, weeks] = await Promise.all([
    tagsByProject(db, [row.id]),
    listDailyArrivals(db, row.repoId),
    listWeeklyArrivals(db, row.repoId),
  ])

  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    fullName: fullNameOf(row),
    description: row.description,
    stars: row.stars ?? 0,
    type: row.type,
    status: row.status,
    logo: row.logo,
    iconUrl: row.iconUrl,
    avatar: githubAvatarUrl(row.owner, { ownerId: row.ownerId }),
    tags: byProject.get(row.id) ?? [],
    url: row.url,
    language: row.languages?.[0] ?? null,
    license: row.license,
    pushedAt: row.pushedAt,
    createdAt: row.createdAt,
    repoId: row.repoId,
    latestReleasePublishedAt: row.latestReleasePublishedAt,
    forks: row.forks ?? 0,
    contributors: row.contributors,
    releases: row.releases ?? 0,
    readme: row.readme,
    readmeZh: row.readmeZh,
    days,
    weeks,
  }
}

/**
 * The author behind a repository owner, or `undefined` when nobody is recorded.
 *
 * Keyed on the repository's owner because that is the only thing known about an
 * author before anyone writes them down: `repos.authorId` exists but is
 * unattached (see the schema), and `upsertAuthorFromRepo` records the owner as
 * the author as a side effect of the repository existing. So a project with no
 * entry here simply has no byline yet, which is a normal state rather than an
 * error, and the page omits the card instead of inventing one.
 */
export async function getPublicAuthor(
  db: Db,
  username: string
): Promise<PublicAuthor | undefined> {
  const rows = await db
    .select({
      username: hallOfFame.username,
      name: hallOfFame.name,
      bio: hallOfFame.bio,
      avatar: hallOfFame.avatar,
      avatarUrl: hallOfFame.avatarUrl,
      followers: hallOfFame.followers,
      verified: hallOfFame.verified,
      homepage: hallOfFame.homepage,
      twitter: hallOfFame.twitter,
      linkedin: hallOfFame.linkedin,
      npmUsername: hallOfFame.npmUsername,
    })
    .from(hallOfFame)
    .where(eq(hallOfFame.username, username))
    .limit(1)

  return rows[0]
}

/**
 * Other public projects to offer a reader who liked this one.
 *
 * Ranked by how many tags the two projects share, then by stars, and capped at
 * `limit` because this is a sidebar rather than a search result page. Sharing a
 * tag is the whole signal: the table has no similarity score, and a project
 * sharing two of a reader's interests is a better next click than the single
 * most-starred repository that shares none of them.
 *
 * Hidden projects are excluded by `PUBLIC_WHERE`, and the project itself is
 * excluded by id rather than by owner/name, because two projects can legitimately
 * carry the same name under different owners.
 */
export async function listRelatedPublicProjects(
  db: Db,
  input: { projectId: string; tagCodes: string[]; limit?: number }
): Promise<PublicProjectSummary[]> {
  const limit = input.limit ?? RELATED_PROJECTS_LIMIT
  if (input.tagCodes.length === 0) return []

  const rows = await db
    .select({
      ...SUMMARY_COLUMNS,
      shared: sql<number>`count(distinct ${projectsToTags.tagId})::int`,
    })
    .from(projectsToTags)
    .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
    .innerJoin(projects, eq(projectsToTags.projectId, projects.id))
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(
      and(
        inArray(tags.code, input.tagCodes),
        ne(projects.id, input.projectId),
        PUBLIC_WHERE
      )
    )
    // Grouping by both primary keys is what lets the summary columns stay out of
    // the list: Postgres only treats a column as implied when the grouped key is
    // the primary key of that column's own table, so grouping by `projects.id`
    // alone covers the project columns but leaves `repos.iconUrl` rejected.
    .groupBy(projects.id, repos.id)
    .orderBy(
      desc(sql`count(distinct ${projectsToTags.tagId})`),
      desc(repos.stars)
    )
    .limit(limit)

  const byProject = await tagsByProject(
    db,
    rows.map((row) => row.id)
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner,
    fullName: fullNameOf(row),
    description: row.description,
    stars: row.stars ?? 0,
    type: row.type,
    status: row.status,
    logo: row.logo,
    iconUrl: row.iconUrl,
    avatar: avatarOf(row),
    tags: byProject.get(row.id) ?? [],
  }))
}

/** How many related projects the sidebar offers. */
const RELATED_PROJECTS_LIMIT = 5

/** How many public projects there are, for the category page's summary line. */
export async function countPublicProjects(db: Db): Promise<number> {
  const row = await db
    .select({ total: count() })
    .from(projects)
    .where(PUBLIC_WHERE)
  return row[0]?.total ?? 0
}
