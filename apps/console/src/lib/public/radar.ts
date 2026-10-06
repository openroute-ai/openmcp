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

import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm"
import {
  categories,
  hallOfFame,
  PROJECT_TYPES,
  projectSkills,
  projects,
  projectsToTags,
  repos,
  repoWeeklyStats,
  tags,
} from "@/db/schema"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { primaryLanguage } from "@/lib/github/languages"
import { NO_DESCRIPTION } from "@/lib/github/service/project"
import type { Db } from "@/lib/github/service/repo"
import {
  listDailyArrivals,
  listWeeklyArrivals,
  type DailyArrivals,
  type WeeklyArrivals,
} from "@/lib/github/service/stats"
import {
  PROJECT_TYPE_LABELS,
  type PublicProjectFacet,
  type PublicProjectFacets,
  type PublicProjectQuery,
  type PublicProjectSort,
} from "@/lib/public/project-filters"

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
 * One page of every public project carrying a tag, most-starred first.
 *
 * Paged in SQL rather than in the page because a category is unbounded — the
 * whole promise of a shelf is that everything filed under it is reachable — and a
 * reader scrolling to the end of one response holding the whole tag is not
 * browsing, they are waiting. `limit`/`offset` rather than a cursor because the
 * order is a star count that a sync rewrites wholesale, so a cursor over the sort
 * key would skip or repeat rows between two page views for nothing that the
 * fully-deterministic order below does not already buy.
 *
 * The caller passes the window rather than a page number because it has to know
 * how many pages there are before it can turn `?page=` into one — see
 * {@link countPublicProjectsByTag}, which it reads first.
 *
 * Projects with no recorded star count sort last rather than first: `stars` is
 * nullable, and a Postgres `DESC` puts nulls first, which would top the page
 * with rows that simply have not been measured.
 */
export async function listPublicProjectsByTag(
  db: Db,
  code: string,
  input: { limit: number; offset: number }
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
    //
    // Owner and id close the order because a page break is a claim about the
    // sequence: two projects sharing a name under different owners at the same
    // star count would otherwise be free to swap places between one page view and
    // the next, and a row that turns up on two pages is worse than one that is
    // briefly out of order.
    .orderBy(
      sql`${repos.stars} desc nulls last`,
      projects.name,
      projects.owner,
      projects.id
    )
    .limit(input.limit)
    .offset(input.offset)

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

/**
 * How many public projects carry a tag: the denominator a page's controls need.
 *
 * A separate read rather than a `count(*) over ()` on the page itself, because
 * the page has to know the total *before* it can ask for one. `?page=` is clamped
 * against this so a stale or mistyped link lands on the last page that exists
 * rather than on an empty one; a total carried only by the returned rows arrives
 * too late to clamp against, and arrives not at all when the offset overshoots,
 * which is the very case the clamp exists for.
 *
 * `countDistinct` and the same `repos` join the list uses, because a count that
 * counts a different set than the rows it counts is the one thing a page control
 * cannot recover from: the total would promise a page the list never fills.
 */
export async function countPublicProjectsByTag(
  db: Db,
  code: string
): Promise<number> {
  const rows = await db
    .select({ total: countDistinct(projects.id) })
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .innerJoin(projectsToTags, eq(projectsToTags.projectId, projects.id))
    .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(and(eq(tags.code, code), PUBLIC_WHERE))

  return rows[0]?.total ?? 0
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
  /** Per-day star growth, ascending, days nobody measured left undefined. */
  days: DailyArrivals[]
  /** Per-ISO-week star growth, ascending. */
  weeks: WeeklyArrivals[]
}

/** The four fields a page title and description are built from. */
export interface PublicProjectIdentity {
  owner: string
  name: string
  fullName: string
  description: string | null
}

/**
 * Just enough of a project to name it: what `generateMetadata` needs and nothing
 * else.
 *
 * This exists because {@link getPublicProjectDetail} is the wrong read for a page
 * title. It fans out to three more queries (tags, daily arrivals, weekly
 * arrivals) to render a 90-day chart and a weekly chart, and Next.js runs
 * `generateMetadata` and the page component as separate passes over the same
 * request — it memoises `fetch`, not arbitrary database reads, so calling the
 * detail read from both meant the chart was fetched twice for one page view and
 * the pool was asked for connections twice over. On a cold or remote database
 * that is the difference between a slow page and a `timeout exceeded when trying
 * to connect`.
 *
 * So metadata reads four columns and stops. Everything below is still fetched
 * exactly once, by the component that actually renders it.
 */
export async function getPublicProjectIdentity(
  db: Db,
  owner: string,
  name: string
): Promise<PublicProjectIdentity | undefined> {
  const rows = await db
    .select({
      owner: projects.owner,
      name: projects.name,
      description: projects.description,
    })
    .from(projects)
    .where(
      and(eq(projects.owner, owner), eq(projects.name, name), PUBLIC_WHERE)
    )

  const row = rows[0]
  if (!row) return undefined

  return {
    ...row,
    fullName: fullNameOf(row),
  }
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
      // taking the first name here. The entries are normalised on the way out
      // because rows written before the current writer store language objects
      // rather than names — see `github/languages.ts`.
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
    language: primaryLanguage(row.languages),
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
 * The projects an author has had collected, most-starred first.
 *
 * One person's shelf for the author page: everything in the platform whose
 * repository owner is this person, hidden projects excluded like everywhere
 * else. The owner key is the same column the detail page's author card is read
 * by, so the two pages cannot drift about who wrote what. Unpaginated because
 * one author's collection is small; the tie-breakers after stars close the
 * order the same way the tag list closes theirs, so two projects sharing a star
 * count never swap places fitfully between renders.
 */
export async function listPublicProjectsByAuthor(
  db: Db,
  owner: string
): Promise<PublicProjectSummary[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(and(eq(projects.owner, owner), PUBLIC_WHERE))
    .orderBy(
      sql`${repos.stars} desc nulls last`,
      projects.name,
      projects.owner,
      projects.id
    )

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

/**
 * The `/projects` browser: the whole public catalog, filterable and sortable.
 *
 * The rankings answer "what moved this period" and the categories answer "what
 * is filed under this tag"; neither is the catalog — the ranking has an editorial
 * ceiling and a category is one shelf. This is the queryable list, and like the
 * category pages it is paged in SQL and by URL, for the same reason: a catalog is
 * a place a reader is meant to reach into an unbounded table, and `?page=` is the
 * only address a crawler can cite.
 *
 * The three facets — type, category, tag — constrain a *set* of projects rather
 * than a sequence, so they are framed as `exists` subqueries instead of joins:
 * there is no risk of row multiplication, and the `count` and the list queries
 * agree without anyone having to keep them in step by hand.
 */

/**
 * One row of the catalog, with the movement the growth sort was ordered on.
 *
 * `delta` is only ever filled when the caller sorted by `growth`, and only then
 * relays the same Δ the rankings are sorted on — the incremental week the reader
 * asked for by choosing that sort, not a second number to reconcile.
 */
export interface PublicProjectListRow extends PublicProjectSummary {
  createdAt: Date
  /** The starred gain over the latest completed week, or `null` without one. */
  delta: number | null
}

/**
 * One page of the catalog under `input`'s sort and filters.
 *
 * The growth sort needs a single reference week, taken as the newest row of the
 * whole stats table rather than each repo's own freshest row: the former compares
 * every row within the same window, the latter mixes gains from different weeks
 * into one ordering. When the stats table is empty there is no such window —
 * the newest-day scan returns nothing — and the list degrades to the newest
 * ordering rather than to an empty catalog.
 */
export async function listPublicProjects(
  db: Db,
  input: PublicProjectQuery & { limit: number; offset: number }
): Promise<PublicProjectListRow[]> {
  const conditions = projectConditions(input)
  const period = input.sort === "growth" ? await latestWeeklyPeriod(db) : null

  const select = {
    ...SUMMARY_COLUMNS,
    createdAt: projects.createdAt,
    delta: period
      ? sql<number | null>`${repoWeeklyStats.deltaStars}`
      : sql<number | null>`null`,
    // The "growth" fallback for the placeholder an editor's "clear" leaves in
    // `projects.description`; an empty plain text would otherwise tell a reader
    // nothing at all about a repository the upstream README describes.
    repoDescription: repos.description,
  }

  const rows = period
    ? await db
        .select(select)
        .from(projects)
        .innerJoin(repos, eq(projects.repoId, repos.id))
        .leftJoin(
          repoWeeklyStats,
          and(
            eq(repoWeeklyStats.repoId, repos.id),
            eq(repoWeeklyStats.period, period)
          )
        )
        .where(and(...conditions))
        .orderBy(...orderByFor(input.sort, period))
        .limit(input.limit)
        .offset(input.offset)
    : await db
        .select(select)
        .from(projects)
        .innerJoin(repos, eq(projects.repoId, repos.id))
        .where(and(...conditions))
        .orderBy(...orderByFor(input.sort, period))
        .limit(input.limit)
        .offset(input.offset)

  const byProject = await tagsByProject(
    db,
    rows.map((row) => row.id)
  )

  return rows.map(({ repoDescription, ...row }) => ({
    ...row,
    stars: row.stars ?? 0,
    fullName: fullNameOf(row),
    tags: byProject.get(row.id) ?? [],
    avatar: avatarOf(row),
    description:
      row.description === NO_DESCRIPTION
        ? repoDescription ?? ""
        : row.description,
  }))
}

/**
 * How many projects match `query`: the denominator the page controls clamp to.
 *
 * Same conditions as {@link listPublicProjects}, so the total and the rows answer
 * the same set — a count that counted a different set would promise a page the
 * list never fills (the same reasoning as
 * {@link countPublicProjectsByTag}).
 */
export async function countPublicProjectsForQuery(
  db: Db,
  query: PublicProjectQuery
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(projects)
    .where(and(...projectConditions(query)))
  return rows[0]?.total ?? 0
}

/**
 * The three facet rails, counted under the *other* filters.
 *
 * A type facet that counts only unfiltered projects would say "客户端 19" while
 * the tag filter is active and the tag facet says "mcp 3" — and the two rails
 * would each claim to describe the same list. Omitting the rail being counted is
 * the rule that keeps them coherent: each count answers "matching the keyword,
 * the other two filters, and *this* value".
 *
 * Types are a closed enum, so all five are always offered and missing ones read
 * zero — a closed set's empty option is still a real state. Categories and tags
 * are open vocabularies, so only values with a nonzero count are offered, plus
 * the currently selected one when the other filters emptied it: a reader must be
 * able to switch a filter off, and a select that has lost the row it is showing
 * cannot be switched off.
 */
export async function listPublicProjectFacets(
  db: Db,
  query: PublicProjectQuery
): Promise<PublicProjectFacets> {
  const [typeRows, categoryRows, tagRows] = await Promise.all([
    db
      .select({ value: projects.type, count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(...projectConditions(query, "type")))
      .groupBy(projects.type),
    db
      .select({
        code: categories.code,
        label: categories.name,
        count: sql<number>`count(*)::int`,
      })
      .from(projects)
      .innerJoin(categories, eq(categories.id, projects.categoryId))
      .where(and(...projectConditions(query, "category")))
      .groupBy(categories.id)
      .orderBy(desc(sql`count(*)`), categories.code),
    db
      .select({
        code: tags.code,
        label: tags.name,
        count: sql<number>`count(*)::int`,
      })
      .from(projects)
      .innerJoin(projectsToTags, eq(projectsToTags.projectId, projects.id))
      .innerJoin(tags, eq(tags.id, projectsToTags.tagId))
      .where(
        and(
          eq(tags.excludeFromRankings, false),
          ...projectConditions(query, "tag")
        )
      )
      .groupBy(tags.id)
      .orderBy(desc(sql`count(*)`), tags.code),
  ])

  const typeCounts = new Map(typeRows.map((row) => [row.value, row.count]))

  return {
    types: PROJECT_TYPES.map((value) => ({
      value,
      label: PROJECT_TYPE_LABELS[value],
      count: typeCounts.get(value) ?? 0,
    })),
    categories: keepFacetSelected(
      populatedFacets(categoryRows),
      query.category
    ),
    tags: keepFacetSelected(populatedFacets(tagRows), query.tag),
  }
}

/** The SQL an anonymous browse request always carries, plus the in-set filters. */
function projectConditions(
  query: PublicProjectQuery,
  omit?: "type" | "category" | "tag"
): SQL[] {
  const conditions: SQL[] = [PUBLIC_WHERE]

  if (omit !== "type" && query.type) {
    conditions.push(eq(projects.type, query.type))
  }
  if (omit !== "category" && query.category) {
    conditions.push(categoryCondition(query.category))
  }
  if (omit !== "tag" && query.tag) {
    conditions.push(tagCondition(query.tag))
  }

  const keyword = keywordCondition(query.q)
  if (keyword) conditions.push(keyword)

  return conditions
}

function categoryCondition(code: string): SQL {
  // A correlated subquery quoting the outer row's own column, not a join: a
  // filter is the question "is it filed under X", and a join would fan the row
  // out and force the count query to rebuild the same shape by hand.
  return sql<boolean>`exists (
    select 1 from ${categories} c
    where c.id = ${projects.categoryId} and c.code = ${code}
  )`
}

function tagCondition(code: string): SQL {
  return sql<boolean>`exists (
    select 1 from ${projectsToTags} ptt
    inner join ${tags} t on t.id = ptt.tag_id
    where ptt.project_id = ${projects.id}
      and t.code = ${code}
      and t.exclude_from_rankings = false
  )`
}

/**
 * The keyword search, or `undefined` when there is nothing to search for.
 *
 * The pattern follows the reference app's project list: an `ilike`-match on the
 * name, owner and description — plus the slug, which is where a project's
 * romanised id lives. `_` and `%` in the keyword are escaped rather than let
 * through, so a search for "100%" is a search for the characters, not a wildcard
 * a malicious query could turn into a full scan.
 */
function keywordCondition(q: string): SQL | undefined {
  const term = q.trim()
  if (!term) return undefined
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
  return or(
    ilike(projects.name, pattern),
    ilike(projects.owner, pattern),
    ilike(projects.description, pattern),
    ilike(projects.slug, pattern)
  )
}

/**
 * The newest completed week in the stats table, or `null` when it holds nothing.
 *
 * The same index-only backward scan as `latestDailyPeriod` in the rankings
 * service; the boundary is the table's own newest row rather than `now()`, since
 * a week is a calendar period with a written edge and deriving it would be wrong
 * by construction.
 */
async function latestWeeklyPeriod(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ period: repoWeeklyStats.period })
    .from(repoWeeklyStats)
    .orderBy(desc(repoWeeklyStats.period))
    .limit(1)
  return rows[0]?.period ?? null
}

function orderByFor(sort: PublicProjectSort, period: Date | null): SQL[] {
  if (sort === "stars") {
    return [sql`${repos.stars} desc nulls last`, asc(projects.id)]
  }
  if (sort === "growth") {
    // The stats table can be empty before the first sweep; a growth ranking
    // over a window that does not exist reads better as the newest list.
    return period
      ? [sql`${repoWeeklyStats.deltaStars} desc nulls last`, asc(projects.id)]
      : [desc(projects.createdAt), asc(projects.id)]
  }
  return [desc(projects.createdAt), asc(projects.id)]
}

function populatedFacets(
  rows: { code: string; label: string; count: number }[]
): PublicProjectFacet[] {
  return rows
    .filter((row) => row.count > 0)
    .map((row) => ({ code: row.code, label: row.label, count: Number(row.count) }))
}

function keepFacetSelected(
  options: PublicProjectFacet[],
  selected: string | undefined
): PublicProjectFacet[] {
  if (!selected || options.some((option) => option.code === selected)) {
    return options
  }
  return [...options, { code: selected, label: selected, count: 0 }]
}

/**
 * A skill a project ships, as the public pages may show it.
 *
 * Deliberately a subset of the row: the push state, the content hash and the
 * parse errors are the back office's business, and `readme` is heavy enough to
 * skip for a list that names a skill rather than documents it. `skillDir` is
 * the natural ordering key — a directory path is stable, unlike a row id.
 */
export interface PublicProjectSkill {
  skillDir: string
  name: string
  description: string
  descriptionZh: string
  version: string | null
}

/**
 * The skills stored for one project, ordered by their directory.
 *
 * A skill repository carries its skills as `SKILL.md` documents, one per
 * directory; `project_skills` is what the sync wrote from them. The reader is
 * keyed by project id (the listing callers see on the dashboard uses the same
 * key) and needs no joins — the caller has already resolved the project by the
 * time it asks for skills.
 */
export async function listPublicProjectSkills(
  db: Db,
  projectId: string
): Promise<PublicProjectSkill[]> {
  return db
    .select({
      skillDir: projectSkills.skillDir,
      name: projectSkills.name,
      description: projectSkills.description,
      descriptionZh: projectSkills.descriptionZh,
      version: projectSkills.version,
    })
    .from(projectSkills)
    .where(eq(projectSkills.projectId, projectId))
    .orderBy(asc(projectSkills.skillDir))
}
