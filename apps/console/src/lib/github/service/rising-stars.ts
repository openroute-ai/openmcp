/**
 * The Rising Stars report - projects that gained the most stargazers in a
 * calendar year, filtered through the category configuration.
 *
 * In the source app this was a flat file produced by a task that read its
 * category configuration from `../javascript-risingstars/src/content/
 * categories/{year}.json`, a sibling application that is not part of this
 * repository, so the task failed with ENOENT every time it ran. The shell is
 * gone: categories now live in the `rising_star_categories` table, seeded from
 * `defaultRisingStarCategories`, and the computed list is stored in
 * `rising_star_projects` as well as published as the JSON artefact a consumer
 * enumerates.
 *
 * The numbers are re-derived from the monthly star history because it is the
 * only complete record. A "final snapshot" of a year is the first month's
 * running total of the year after it, which is the count at the moment the
 * year closed - the same value the source read off its first-of-next-year
 * snapshot, and available here long after that snapshot would have been
 * pruned.
 */

import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm"
import {
  projects,
  projectsToTags,
  repoMonthlyStats,
  repos,
  risingStarCategories,
  risingStarProjects,
  tags,
  type RisingStarCategory,
} from "@/db/schema"
import { monthOfPeriod, periodFromMonth } from "@/lib/github/snapshot-dates"
import { NO_DESCRIPTION } from "@/lib/github/service/project"
import type { Db } from "@/lib/github/service/repo"
import type { MonthlyStatsRow } from "@/lib/github/service/stats"
import { APP_TIMEZONE } from "@/lib/time"

/**
 * One month of a repository's stored history, named by calendar rather than by
 * the instant the table holds.
 */
interface MonthlyPoint {
  year: number
  month: number
  /** The level the month closed at, or null when it was never measured. */
  stars: number | null
  /** Movement over the month, or null when there is no comparable prior. */
  delta: number | null
}

/**
 * Names each stored row by the calendar month it belongs to, oldest first.
 *
 * The table keys on the instant the month opened, so the year and month are read
 * back through the application timezone. Reading the UTC fields instead would
 * file every October under September, because the month opens on the 30th at
 * 16:00 UTC.
 *
 * The repository id travels with each point so the caller can group a single
 * ordered read by repository without a second pass.
 */
function monthlyPoints(
  rows: Pick<MonthlyStatsRow, "repoId" | "period" | "totalStars" | "deltaStars">[]
): { repoId: string; point: MonthlyPoint }[] {
  return rows
    .map((row) => ({
      repoId: row.repoId,
      point: {
        ...monthOfPeriod(row.period, APP_TIMEZONE),
        stars: row.totalStars,
        delta: row.deltaStars,
      },
    }))
    .sort(
      (a, b) =>
        a.repoId.localeCompare(b.repoId) ||
        a.point.year - b.point.year ||
        a.point.month - b.point.month
    )
}

/** One project as it appears in the Rising Stars JSON artefact. */
export interface RisingStarProject {
  name: string
  slug: string
  full_name: string
  description: string
  stars: number
  /** Stargazers gained across the whole year. */
  delta: number
  /** Growth per month, December first, so a reader can chart the year. */
  monthly: (number | null)[]
  tags: string[]
  owner_id: number
  created_at: string
  icon?: string
  url?: string
}

/** The JSON artefact, kept faithful to the source's shape. */
export interface RisingStarsReport {
  date: string
  count: number
  projects: RisingStarProject[]
  /** Every tag the selected projects carry, name and code. */
  tags: { name: string; code: string }[]
}

/**
 * The starting category configuration for a year.
 *
 * "all" is required - it is the overall bucket every sub-category draws from -
 * and the others are a best-effort list keyed by tag codes this application
 * already uses. Editors replace the per-year row in the database; the seed
 * only exists so a fresh install has something coherent to run.
 */
export const defaultRisingStarCategories: RisingStarCategory[] = [
  { key: "all", count: 60 },
  { key: "framework", count: 15, tags: ["framework"] },
  { key: "meta-framework", count: 15, tags: ["meta-framework"] },
  { key: "data-visualization", count: 15, tags: ["data-visualization"] },
  { key: "database", count: 15, tags: ["database"] },
  { key: "testing", count: 15, tags: ["testing"] },
  { key: "build-tooling", count: 15, tags: ["build-tooling"] },
  { key: "css", count: 15, tags: ["css"] },
  { key: "cli", count: 15, tags: ["cli"] },
]

/**
 * The configuration for a year, falling back to the default.
 *
 * The fallback row is written only when `seed` is set. A read that inserted
 * would make every read path a writer, and two of them are not supposed to be
 * able to write at all: the dashboard query and the public JSON endpoint are
 * both unauthenticated reads, so a write here would be an anonymous request
 * mutating a table. The build seeds instead, so a year that has been computed
 * always has a row an editor can open.
 */
export async function getRisingStarCategories(
  db: Db,
  year: number,
  options: { seed?: boolean } = {}
): Promise<RisingStarCategory[]> {
  const [row] = await db
    .select()
    .from(risingStarCategories)
    .where(eq(risingStarCategories.year, year))

  if (row) return row.categories

  if (options.seed) {
    await db
      .insert(risingStarCategories)
      .values({ year, categories: defaultRisingStarCategories })
      .onConflictDoNothing()
  }

  return defaultRisingStarCategories
}

/**
 * The seed configuration, for an editor that wants to put it back.
 *
 * Returned by the server rather than imported into the dialog, because the
 * default lives beside the selection that reads it and importing that module
 * into a client component would pull the whole Drizzle schema into the browser
 * bundle.
 */
export function listDefaultRisingStarCategories(): RisingStarCategory[] {
  return defaultRisingStarCategories.map((category) => ({ ...category }))
}

interface Candidate {
  repoId: string
  fullName: string
  ownerId: number
  currentStars: number | null
  contributors: number | null
  repoDescription: string | null
  homepage: string | null
  createdAt: Date
  projectId: string
  projectName: string
  projectSlug: string
  projectDescription: string
  projectOverrideDescription: boolean | null
  projectUrl: string | null
  projectOverrideUrl: boolean | null
  projectLogo: string | null
  tagCodes: string[]
}

/**
 * A computed report, before it is written anywhere.
 *
 * The category each project was picked by and its contributor count are part of
 * the result rather than being re-derived, because only the build has both and
 * the table's columns are filled from them.
 */
export interface ComputedRisingStars {
  report: RisingStarsReport
  categoryByFullName: Map<string, string>
  contributorsByFullName: Map<string, number | null>
}

/**
 * Computes the report for a year, without writing.
 *
 * Candidates are repositories that have monthly history for that year, joined
 * to their project. Hidden and deprecated projects are skipped, matching
 * every other public surface: a report is not a place to advertise work that
 * is deliberately off the site.
 *
 * Read-only on purpose, and this is the function the dashboard and the public
 * JSON endpoint use. The projection is deterministic — it depends only on the
 * snapshot history and the stored categories — so a read that recomputes returns
 * exactly what a build would have written, and it does not need the write to
 * prove it. `buildRisingStarsForYear` is the one that persists.
 */
export async function computeRisingStarsForYear(
  db: Db,
  year: number,
  date = new Date()
): Promise<ComputedRisingStars> {
  const candidateIds = await repoIdsWithMonthlyHistory(db, year)

  // No repository has history for the year, so there is nothing to rank. Handled
  // before the join rather than by `inArray` on an empty list, which Drizzle
  // renders as a predicate that matches nothing at all.
  if (candidateIds.length === 0) {
    const categories = await getRisingStarCategories(db, year)
    const { projects: selected, categoryByFullName } = selectByCategory(
      [],
      categories,
      new Set()
    )
    return {
      report: {
        date: date.toISOString(),
        count: selected.length,
        projects: selected,
        tags: [],
      },
      categoryByFullName,
      contributorsByFullName: new Map(),
    }
  }

  const rows = await db
    .select({
      repoId: repos.id,
      fullName: sql<string>`${repos.owner} || '/' || ${repos.name}`.as(
        "full_name"
      ),
      ownerId: repos.ownerId,
      currentStars: repos.stars,
      contributors: repos.contributorCount,
      repoDescription: repos.description,
      homepage: repos.homepage,
      createdAt: repos.createdAt,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      projectDescription: projects.description,
      projectOverrideDescription: projects.overrideDescription,
      projectUrl: projects.url,
      projectOverrideUrl: projects.overrideUrl,
      projectLogo: projects.logo,
      tagCode: tags.code,
    })
    .from(repos)
    .innerJoin(projects, eq(projects.repoId, repos.id))
    .leftJoin(projectsToTags, eq(projectsToTags.projectId, projects.id))
    .leftJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(
      and(
        inArray(repos.id, candidateIds),
        ne(projects.status, "hidden"),
        ne(projects.status, "deprecated")
      )
    )

  const excludedTagCodes = new Set(
    (
      await db
        .select({ code: tags.code })
        .from(tags)
        .where(eq(tags.excludeFromRankings, true))
    ).map((row) => row.code)
  )

  const byProject = new Map<string, Candidate>()
  for (const row of rows) {
    const existing = byProject.get(row.projectId)
    if (existing) {
      if (row.tagCode) existing.tagCodes.push(row.tagCode)
      continue
    }
    byProject.set(row.projectId, {
      repoId: row.repoId,
      fullName: row.fullName,
      ownerId: row.ownerId,
      currentStars: row.currentStars,
      contributors: row.contributors,
      repoDescription: row.repoDescription,
      homepage: row.homepage,
      createdAt: row.createdAt,
      projectId: row.projectId,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
      projectDescription: row.projectDescription,
      projectOverrideDescription: row.projectOverrideDescription,
      projectUrl: row.projectUrl,
      projectOverrideUrl: row.projectOverrideUrl,
      projectLogo: row.projectLogo,
      tagCodes: row.tagCode ? [row.tagCode] : [],
    })
  }

  const snapshotRows = await db
    .select({
      repoId: repoMonthlyStats.repoId,
      period: repoMonthlyStats.period,
      totalStars: repoMonthlyStats.totalStars,
      deltaStars: repoMonthlyStats.deltaStars,
    })
    .from(repoMonthlyStats)
    .where(
      inArray(
        repoMonthlyStats.repoId,
        [...byProject.values()].map((candidate) => candidate.repoId)
      )
    )
    .orderBy(asc(repoMonthlyStats.repoId), asc(repoMonthlyStats.period))

  // A repository's history spans many rows, so they are grouped per repository
  // and read in one query rather than one query per candidate.
  const grouped = new Map<string, MonthlyPoint[]>()
  for (const row of monthlyPoints(snapshotRows)) {
    const entry = grouped.get(row.repoId)
    if (entry) entry.push(row.point)
    else grouped.set(row.repoId, [row.point])
  }

  const measured: RisingStarProject[] = []
  const contributors = new Map<string, number | null>()

  for (const candidate of byProject.values()) {
    const history = grouped.get(candidate.repoId) ?? []
    const project = projectData(candidate, year, history)
    if (!project) continue
    measured.push(project)
    contributors.set(candidate.fullName, candidate.contributors)
  }

  measured.sort((a, b) => b.delta - a.delta)

  const categories = await getRisingStarCategories(db, year)
  const { projects: selected, categoryByFullName } = selectByCategory(
    measured,
    categories,
    excludedTagCodes
  )

  const usedCodes = new Set(selected.flatMap((project) => project.tags))
  const usedTags =
    usedCodes.size === 0
      ? []
      : await db
          .select({ name: tags.name, code: tags.code })
          .from(tags)
          .where(inArray(tags.code, [...usedCodes]))

  return {
    report: {
      date: date.toISOString(),
      count: selected.length,
      projects: selected,
      tags: usedTags,
    },
    categoryByFullName,
    contributorsByFullName: contributors,
  }
}

/**
 * Computes a year and writes the selection to `rising_star_projects`.
 *
 * This is the only path that persists, and it is what the yearly task and the
 * editor's rebuild button both use, so the table and the published artefact
 * cannot disagree. The category row is seeded first, so a year that was built
 * has something to open in the editor even when the report came out empty.
 */
export async function buildRisingStarsForYear(
  db: Db,
  year: number,
  date = new Date()
): Promise<RisingStarsReport> {
  await getRisingStarCategories(db, year, { seed: true })

  const computed = await computeRisingStarsForYear(db, year, date)
  await persistRisingStars(
    db,
    year,
    computed.report.projects,
    computed.categoryByFullName,
    computed.contributorsByFullName
  )

  return computed.report
}

/**
 * Repository ids holding monthly history inside a calendar year.
 *
 * The window is taken on the stored instants rather than on an extracted year,
 * because the table has no year column — a month is identified by when it
 * opened. The upper bound is exclusive, which is what keeps December out of
 * January's candidate list.
 */
async function repoIdsWithMonthlyHistory(
  db: Db,
  year: number
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ repoId: repoMonthlyStats.repoId })
    .from(repoMonthlyStats)
    .where(
      and(
        gte(repoMonthlyStats.period, periodFromMonth({ year, month: 1 })),
        lt(
          repoMonthlyStats.period,
          periodFromMonth({ year: year + 1, month: 1 })
        )
      )
    )

  return rows.map((row) => row.repoId)
}

/** Builds one project's report entry, or null when it grew nothing. */
function projectData(
  candidate: Candidate,
  year: number,
  history: MonthlyPoint[]
): RisingStarProject | undefined {
  const delta = yearlyDelta(candidate, year, history)
  if (delta <= 0) return undefined

  const currentYear = new Date().getFullYear()
  const stars =
    currentYear === year
      ? (candidate.currentStars ?? 0)
      : (firstStarsOfYear(history, year + 1) ?? 0)

  // December first, so a consumer charting the array gets the year backwards
  // without reversing it.
  const monthlyDeltas = new Map(
    history.map((point) => [`${point.year}-${point.month}`, point.delta])
  )
  const monthly: (number | null)[] = []
  for (let month = 12; month >= 1; month--) {
    monthly.push(monthlyDeltas.get(`${year}-${month}`) ?? null)
  }

  return {
    name: candidate.projectName,
    slug: candidate.projectSlug,
    full_name: candidate.fullName,
    description: projectDescription(candidate),
    stars,
    delta,
    monthly,
    tags: candidate.tagCodes,
    owner_id: candidate.ownerId,
    created_at: candidate.createdAt.toISOString(),
    ...(candidate.projectLogo ? { icon: candidate.projectLogo } : {}),
    ...(projectUrl(candidate) ? { url: projectUrl(candidate)! } : {}),
  }
}

/**
 * The year's net star movement.
 *
 * Read from the end of the year to the start of it: the count at the moment the
 * year closed is the first month of the next year's level, falling back to the
 * last month of this year when the history has not reached into the next one.
 * The opening count is likewise the first month of the year's own level, except
 * for a repository created during the year, which starts at zero.
 *
 * Levels rather than the stored monthly deltas, because a month's delta is
 * relative to the month before it and a year with a gap in it would then be
 * undercounted by whatever happened during the gap.
 */
function yearlyDelta(
  candidate: Candidate,
  year: number,
  history: MonthlyPoint[]
): number {
  const finalValue =
    firstStarsOfYear(history, year + 1) ?? lastStarsInYear(history, year)
  if (finalValue === undefined) return 0

  const initialValue =
    candidate.createdAt.getFullYear() === year
      ? 0
      : (firstStarsOfYear(history, year) ?? 0)

  return finalValue - initialValue
}

/** The level the earliest recorded month of a year closed at, if any. */
function firstStarsOfYear(
  history: MonthlyPoint[],
  year: number
): number | undefined {
  return history.find((entry) => entry.year === year)?.stars ?? undefined
}

/** The level the latest recorded month of a year closed at, if any. */
function lastStarsInYear(
  history: MonthlyPoint[],
  year: number
): number | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index]!.year === year) {
      return history[index]!.stars ?? undefined
    }
  }
  return undefined
}

/**
 * The description for the report.
 *
 * An edited description wins; otherwise the repository's own words are
 * preferred, falling back to the project's. The stored placeholder is dropped
 * rather than shipped as a real description.
 */
function projectDescription(candidate: Candidate): string {
  if (candidate.projectOverrideDescription) {
    return candidate.projectDescription
  }
  const project =
    candidate.projectDescription === NO_DESCRIPTION
      ? ""
      : candidate.projectDescription
  return candidate.repoDescription || project
}

/** The link a visitor should follow, per a curated override. */
function projectUrl(candidate: Candidate): string | null {
  if (candidate.projectOverrideUrl) return candidate.projectUrl
  return candidate.homepage && isValidProjectUrl(candidate.homepage)
    ? candidate.homepage
    : candidate.projectUrl
}

/** Whether a homepage is a reasonable link for a report card. */
function isValidProjectUrl(url: string): boolean {
  const invalid = [
    "npmjs.com/",
    "npm.im/",
    "npmjs.org/",
    "/github.com/",
    "twitter.com/",
  ]
  return !invalid.some((pattern) => url.includes(pattern))
}

/** Whether a project carries a tag that is excluded from the rankings. */
function projectCarriesExcludedTag(
  project: RisingStarProject,
  excluded: Set<string>
): boolean {
  return project.tags.some((code) => excluded.has(code))
}

function hasOneOfTags(project: RisingStarProject, codes: string[]): boolean {
  return project.tags.some((code) => codes.includes(code))
}

function hasNotOneOfTags(
  project: RisingStarProject,
  codes?: string[]
): boolean {
  if (!codes) return true
  return !project.tags.some((code) => codes.includes(code))
}

function notExcludedBySlug(project: RisingStarProject, slugs?: string[]) {
  if (!slugs) return true
  return !slugs.includes(project.slug)
}

/**
 * Selects the report's projects from the categories.
 *
 * The "all" bucket takes the top `count` projects, then each enabled
 * sub-category takes its own top `count` matching its tags. A project is
 * selected once; the ordering stays the year's star-delta order. The category
 * that first picked a project is returned alongside, for the per-year rows:
 * "all" runs first, so it owns most of them.
 */
export function selectByCategory(
  input: RisingStarProject[],
  categories: RisingStarCategory[],
  excludedTagCodes: Set<string>
): {
  projects: RisingStarProject[]
  categoryByFullName: Map<string, string>
} {
  // The report is the year's fastest risers first, so the selection is
  // ranked here rather than trusting the caller to have pre-sorted it. The
  // sub-categories then draw from the same ranking.
  const ranked = [...input].sort((a, b) => b.delta - a.delta)
  const chosen = new Map<string, string>()

  const overall = categories.find((category) => category.key === "all")
  if (!overall) throw new Error("Category 'all' not found")

  const top = ranked
    .filter((project) => !projectCarriesExcludedTag(project, excludedTagCodes))
    .slice(0, overall.count)
  for (const project of top) chosen.set(project.full_name, "all")

  const subCategories = categories.filter(
    (category) => category.key !== "all" && category.disabled !== true
  )
  for (const category of subCategories) {
    const selected = ranked
      .filter(
        (project) =>
          hasOneOfTags(project, category.tags || [category.key]) &&
          hasNotOneOfTags(project, category.excludedTags)
      )
      .filter((project) => notExcludedBySlug(project, category.excluded))
      .slice(0, category.count)
    for (const project of selected) {
      if (!chosen.has(project.full_name)) {
        chosen.set(project.full_name, category.key)
      }
    }
  }

  return {
    projects: ranked.filter((project) => chosen.has(project.full_name)),
    categoryByFullName: chosen,
  }
}

/** Replaces the year's rows with the freshly computed selection. */
export async function persistRisingStars(
  db: Db,
  year: number,
  projectsToWrite: RisingStarProject[],
  categoryByFullName: Map<string, string>,
  contributorsByFullName: Map<string, number | null>
): Promise<number> {
  await db.delete(risingStarProjects).where(eq(risingStarProjects.year, year))

  if (projectsToWrite.length === 0) return 0

  // A repository may carry more than one project, but a row is one per
  // full_name: the report names repositories, and the unique index keys the
  // table that way.
  const seen = new Set<string>()

  await db.insert(risingStarProjects).values(
    projectsToWrite
      .filter((project) => {
        if (seen.has(project.full_name)) return false
        seen.add(project.full_name)
        return true
      })
      .map((project, index) => ({
        id: `rising-${year}-${project.full_name.replace("/", "-")}`,
        year,
        fullName: project.full_name,
        slug: project.slug,
        position: index + 1,
        category: categoryByFullName.get(project.full_name) ?? "all",
        starDelta: project.delta,
        starCount: project.stars,
        contributorsCount:
          contributorsByFullName.get(project.full_name) ?? null,
        data: project as unknown as Record<string, unknown>,
      }))
  )

  return projectsToWrite.length
}
