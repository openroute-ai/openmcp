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
import { projects, projectsToTags, repos, tags } from "@/db/schema"
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
}

const SUMMARY_COLUMNS = {
  id: projects.id,
  name: projects.name,
  owner: projects.owner,
  description: projects.description,
  stars: repos.stars,
  type: projects.type,
  status: projects.status,
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
  }))
}

export interface PublicProjectDetail extends PublicProjectSummary {
  url: string | null
  logo: string | null
  language: string | null
  license: string | null
  pushedAt: Date
  createdAt: Date
  forks: number
  contributors: number | null
  releases: number
  /** Per-day arrivals, ascending, quiet days already filled as zero. */
  days: DailyArrivals[]
  /** Per-ISO-week arrivals, ascending. */
  weeks: WeeklyArrivals[]
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
      repoId: repos.id,
    })
    .from(projects)
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(
      and(
        eq(projects.owner, owner),
        eq(projects.name, name),
        PUBLIC_WHERE
      )
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
    tags: byProject.get(row.id) ?? [],
    url: row.url,
    logo: row.logo,
    language: row.languages?.[0] ?? null,
    license: row.license,
    pushedAt: row.pushedAt,
    createdAt: row.createdAt,
    forks: row.forks ?? 0,
    contributors: row.contributors,
    releases: row.releases ?? 0,
    days,
    weeks,
  }
}

/** How many public projects there are, for the category page's summary line. */
export async function countPublicProjects(db: Db): Promise<number> {
  const row = await db
    .select({ total: count() })
    .from(projects)
    .where(PUBLIC_WHERE)
  return row[0]?.total ?? 0
}
