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

import { and, eq, inArray, ne, sql } from "drizzle-orm"
import {
  projects,
  projectsToTags,
  repos,
  risingStarCategories,
  risingStarProjects,
  snapshots,
  tags,
  type SnapshotMonth,
  type RisingStarCategory,
} from "@/db/schema"
import { NO_DESCRIPTION } from "@/lib/github/service/project"
import type { Db } from "@/lib/github/service/repo"
import {
  computeMonthlyTrend,
  flattenMonths,
} from "@/lib/github/service/snapshot"

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

/** The configuration for a year, seeding the default when none is stored. */
export async function getRisingStarCategories(
  db: Db,
  year: number
): Promise<RisingStarCategory[]> {
  const [row] = await db
    .select()
    .from(risingStarCategories)
    .where(eq(risingStarCategories.year, year))

  if (row) return row.categories

  await db
    .insert(risingStarCategories)
    .values({ year, categories: defaultRisingStarCategories })
    .onConflictDoNothing()

  return defaultRisingStarCategories
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
 * Computes the report for a year.
 *
 * Candidates are repositories that have monthly history for that year, joined
 * to their project. Hidden and deprecated projects are skipped, matching
 * every other public surface: a report is not a place to advertise work that
 * is deliberately off the site.
 */
export async function buildRisingStarsForYear(
  db: Db,
  year: number,
  date = new Date()
): Promise<RisingStarsReport> {
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
        inArray(
          repos.id,
          db
            .select({ repoId: snapshots.repoId })
            .from(snapshots)
            .where(eq(snapshots.year, year))
        ),
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
    .select()
    .from(snapshots)
    .where(
      inArray(
        snapshots.repoId,
        [...byProject.values()].map((candidate) => candidate.repoId)
      )
    )

  // A repository's history spans several year rows, so the rows are grouped
  // and flattened per repository rather than one at a time.
  const grouped: { [repoId: string]: (typeof snapshots.$inferSelect)[] } = {}
  for (const row of snapshotRows) {
    if (!grouped[row.repoId]) grouped[row.repoId] = []
    grouped[row.repoId]!.push(row)
  }

  const byRepo: { [repoId: string]: SnapshotMonth[] } = {}
  for (const [repoId, rows] of Object.entries(grouped)) {
    byRepo[repoId] = flattenMonths(rows)
  }

  const measured: RisingStarProject[] = []
  const contributors = new Map<string, number | null>()

  for (const candidate of byProject.values()) {
    const history = byRepo[candidate.repoId] ?? []
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

  await persistRisingStars(db, year, selected, categoryByFullName, contributors)

  return {
    date: date.toISOString(),
    count: selected.length,
    projects: selected,
    tags: usedTags,
  }
}

/** Builds one project's report entry, or null when it grew nothing. */
function projectData(
  candidate: Candidate,
  year: number,
  history: SnapshotMonth[]
): RisingStarProject | undefined {
  const delta = yearlyDelta(candidate, year, history)
  if (delta <= 0) return undefined

  const currentYear = new Date().getFullYear()
  const stars =
    currentYear === year
      ? (candidate.currentStars ?? 0)
      : (firstStarsOfYear(history, year + 1) ?? 0)

  const monthly: (number | null)[] = []
  const monthlyDeltas = new Map(
    computeMonthlyTrend(history, "stars").map((trend) => [
      `${trend.yearMonth.year}-${trend.yearMonth.month}`,
      trend.delta ?? null,
    ])
  )
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

function yearlyDelta(
  candidate: Candidate,
  year: number,
  history: SnapshotMonth[]
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

/** The running total of the earliest month in a year, if any. */
function firstStarsOfYear(
  history: SnapshotMonth[],
  year: number
): number | undefined {
  return history.find((entry) => entry.year === year)?.stars
}

/** The running total of the latest month in a year, if any. */
function lastStarsInYear(
  history: SnapshotMonth[],
  year: number
): number | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index]!.year === year) return history[index]!.stars
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
