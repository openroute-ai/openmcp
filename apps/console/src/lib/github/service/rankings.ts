/**
 * Star rankings for a period.
 *
 * The source app had two near-identical task files, one for weeks and one for
 * months, differing only in which delta helper they called and how they named
 * the output file. This is that computation once, parameterised by period, so
 * the two cannot drift apart.
 *
 * Where the numbers come from is not a detail, though, and it differs by
 * period:
 *
 * - A monthly delta is the difference of two monthly running totals, both of
 *   which are stored, so any month can be ranked on demand.
 * - A weekly delta needs a per-week split the monthly rows do not contain: a
 *   week straddling the 1st is split across two months and no combination of
 *   them recovers the week's real gain. The stargazer sweep writes that split
 *   to `repo_weekly_stars` while it still holds the raw timestamps, which is
 *   the only moment it is knowable.
 *
 * A period with no data yields empty lists rather than zeros, so a missing week
 * cannot publish a ranking claiming nothing moved.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm"
import {
  projects,
  projectsToTags,
  repos,
  repoWeeklyStars,
  snapshots,
  tags,
  type SnapshotMonth,
} from "@/db/schema"
import {
  previousIsoWeek,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import { NO_DESCRIPTION } from "@/lib/github/service/project"
import type { Db } from "@/lib/github/service/repo"

/** One project as it appears in a ranking. */
export interface RankedProject {
  name: string
  fullName: string
  description: string
  stars: number
  /** Stargazers gained during the period. */
  delta: number
  /**
   * Growth as a fraction of the count before the period.
   *
   * `null` when the project had no stargazers beforehand, because the ratio is
   * undefined there rather than infinite, and publishing `Infinity` would put
   * every brand-new project at the top of the list.
   */
  relativeGrowth: number | null
  tags: string[]
  ownerId: number
  createdAt: Date
}

export interface Rankings {
  period: "week" | "month"
  year: number
  /** Present for a week. */
  week?: number
  /** Present for a month. */
  month?: number
  trending: RankedProject[]
  byRelativeGrowth: RankedProject[]
}

export interface BuildOptions {
  /** How many entries each list keeps. */
  limit?: number
}

const DEFAULT_LIMIT = 100

/** A repository's movement over one period, before it is joined to a project. */
interface Measured {
  repoId: string
  stars: number
  delta: number
  before: number
}

export async function buildRankingsForWeek(
  db: Db,
  yearWeek: YearWeek,
  options: BuildOptions = {}
): Promise<Rankings> {
  const previous = previousIsoWeek(yearWeek)

  const current = await db
    .select({
      repoId: repoWeeklyStars.repoId,
      stars: repoWeeklyStars.stars,
    })
    .from(repoWeeklyStars)
    .where(
      and(
        eq(repoWeeklyStars.year, yearWeek.year),
        eq(repoWeeklyStars.week, yearWeek.week)
      )
    )

  if (current.length === 0) {
    // Nothing was recorded for the week, so publishing would overwrite a good
    // ranking with one claiming the world stood still. The build task keys its
    // "keep the previous file" decision off an empty result.
    return { period: "week", year: yearWeek.year, week: yearWeek.week, trending: [], byRelativeGrowth: [] }
  }

  const anchored = new Set(
    (
      await db
        .select({ repoId: repoWeeklyStars.repoId })
        .from(repoWeeklyStars)
        .where(
          and(
            eq(repoWeeklyStars.year, previous.year),
            eq(repoWeeklyStars.week, previous.week)
          )
        )
    ).map((row) => row.repoId)
  )

  // Weekly rows count the stargazers gained *during* that week, so the listed
  // star count is every row from the start through the target, not this week's
  // row plus the one before it. Adding just the previous week's gain would
  // start every repository's total from zero at week two and lose everything
  // before that; summing the whole span keeps the running total honest while
  // the relative-growth list still only sees the movement in question.
  const history = await db
    .select({
      repoId: repoWeeklyStars.repoId,
      year: repoWeeklyStars.year,
      week: repoWeeklyStars.week,
      stars: repoWeeklyStars.stars,
    })
    .from(repoWeeklyStars)
    .where(
      inArray(
        repoWeeklyStars.repoId,
        current.map((row) => row.repoId)
      )
    )

  const targetKey = yearWeek.year * 100 + yearWeek.week
  const totals = new Map<string, number>()
  for (const row of history) {
    if (row.year * 100 + row.week <= targetKey) {
      totals.set(row.repoId, (totals.get(row.repoId) ?? 0) + row.stars)
    }
  }

  const measured: Measured[] = []

  for (const row of current) {
    // No row for the previous week means the sweep did not cover it, so this
    // week has nothing to be measured against. Reporting it with a `before` of
    // zero would rank every newly-tracked repository as infinitely fast.
    if (!anchored.has(row.repoId)) continue

    const total = totals.get(row.repoId) ?? 0
    measured.push({
      repoId: row.repoId,
      stars: total,
      delta: row.stars,
      before: total - row.stars,
    })
  }

  return assemble(db, {
    period: "week",
    year: yearWeek.year,
    week: yearWeek.week,
    measured,
    limit: options.limit ?? DEFAULT_LIMIT,
  })
}

export async function buildRankingsForMonth(
  db: Db,
  yearMonth: YearMonth,
  options: BuildOptions = {}
): Promise<Rankings> {
  const rows = await db.select().from(snapshots)

  // Grouped by repository before comparing, because a month is stored in the
  // row for its own year and January's predecessor is the previous December,
  // which lives in a different row entirely. Flattening row by row would never
  // see it, and January would silently rank nothing.
  const byRepo = new Map<string, SnapshotMonth[]>()
  for (const row of rows) {
    const existing = byRepo.get(row.repoId)
    if (existing) {
      existing.push(...(row.months ?? []))
    } else {
      byRepo.set(row.repoId, [...(row.months ?? [])])
    }
  }

  const measured: Measured[] = []

  for (const [repoId, months] of byRepo) {
    // Sorted so "the month before" is the element before this one, rather than
    // a filter that has to special-case every boundary.
    const ordered = [...months].sort(
      (a, b) => a.year - b.year || a.month - b.month
    )
    const index = ordered.findIndex(
      (month) => month.year === yearMonth.year && month.month === yearMonth.month
    )
    if (index === -1) continue

    const entry = ordered[index]!
    const prior = ordered[index - 1]
    if (!prior) continue

    // A count that fell is not a declining riser, it is a correction or a
    // transfer, and ranking it as a large negative delta would put it nowhere
    // useful while making the "trending" list misleading.
    if (entry.stars < prior.stars) continue

    measured.push({
      repoId,
      stars: entry.stars,
      delta: entry.stars - prior.stars,
      before: prior.stars,
    })
  }

  return assemble(db, {
    period: "month",
    year: yearMonth.year,
    month: yearMonth.month,
    measured,
    limit: options.limit ?? DEFAULT_LIMIT,
  })
}

/**
 * Joins measured counts to their projects and sorts.
 *
 * The project's own description wins, with the repository's as a fallback. A
 * project is the curated entity: its name, tags and description are what an
 * editor maintains, and the repository description is whatever upstream
 * currently says.
 *
 * The source app preferred the repository description unless an editor had
 * overridden it, keyed off a field that held the override text. That field is
 * a boolean here, marking that the project description should not be
 * overwritten by a refresh, so the question it answered no longer exists and
 * the simpler rule is the one that matches what the column now means.
 */
async function assemble(
  db: Db,
  input: {
    period: "week" | "month"
    year: number
    week?: number
    month?: number
    measured: Measured[]
    limit: number
  }
): Promise<Rankings> {
  const { period, year, week, month, measured, limit } = input
  const header = {
    period,
    year,
    ...(week !== undefined ? { week } : {}),
    ...(month !== undefined ? { month } : {}),
  }

  if (measured.length === 0) {
    return { ...header, trending: [], byRelativeGrowth: [] }
  }

  const counts = new Map(measured.map((entry) => [entry.repoId, entry]))

  const rows = await db
    .select({
      repoId: repos.id,
      fullName: sql<string>`${repos.owner} || '/' || ${repos.name}`.as(
        "full_name"
      ),
      repoDescription: repos.description,
      ownerId: repos.ownerId,
      createdAt: repos.createdAt,
      projectId: projects.id,
      projectName: projects.name,
      projectDescription: projects.description,
      tagCode: tags.code,
      tagExcluded: tags.excludeFromRankings,
    })
    .from(repos)
    .innerJoin(projects, eq(projects.repoId, repos.id))
    .leftJoin(projectsToTags, eq(projectsToTags.projectId, projects.id))
    .leftJoin(tags, eq(projectsToTags.tagId, tags.id))
    .where(
      and(
        inArray(repos.id, [...counts.keys()]),
        // Hidden and deprecated projects are not shown publicly, so ranking
        // them would advertise work that is deliberately off the site.
        ne(projects.status, "hidden"),
        ne(projects.status, "deprecated")
      )
    )

  // One row per project per tag, so the rows are folded back together. A
  // project with no tags still yields one row, with a null tag.
  const byProject = new Map<
    string,
    {
      repoId: string
      fullName: string
      repoDescription: string | null
      ownerId: number
      createdAt: Date
      projectName: string
      projectDescription: string
      tagCodes: string[]
      excluded: boolean
    }
  >()

  for (const row of rows) {
    const existing = byProject.get(row.projectId)
    if (existing) {
      if (row.tagCode) existing.tagCodes.push(row.tagCode)
      if (row.tagExcluded) existing.excluded = true
      continue
    }

    byProject.set(row.projectId, {
      repoId: row.repoId,
      fullName: row.fullName,
      repoDescription: row.repoDescription,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      projectName: row.projectName,
      projectDescription: row.projectDescription,
      tagCodes: row.tagCode ? [row.tagCode] : [],
      // Null when the project has no tags at all, which is not an exclusion.
      excluded: row.tagExcluded === true,
    })
  }

  const ranked: RankedProject[] = []

  for (const project of byProject.values()) {
    // The tag is the exclusion mechanism, and it is per project rather than
    // per repository: tagging a project "meta" hides it while leaving the
    // repository's other projects ranked.
    if (project.excluded) continue

    const measuredForProject = counts.get(project.repoId)
    if (!measuredForProject) continue

    // The project description is the curated one, with the repository's as a
    // fallback. A project that never had a description carries the stored
    // placeholder rather than an empty string, so that case is matched by name
    // and would otherwise shadow the repository's real description.
    const description =
      project.projectDescription &&
      project.projectDescription !== NO_DESCRIPTION
        ? project.projectDescription
        : (project.repoDescription ?? "")

    ranked.push({
      name: project.projectName,
      fullName: project.fullName,
      description: truncate(description, 75),
      stars: measuredForProject.stars,
      delta: measuredForProject.delta,
      relativeGrowth:
        measuredForProject.before === 0
          ? null
          : round(measuredForProject.delta / measuredForProject.before, 4),
      tags: project.tagCodes,
      ownerId: project.ownerId,
      createdAt: project.createdAt,
    })
  }

  return {
    ...header,
    trending: [...ranked]
      .sort((a, b) => b.delta - a.delta)
      .slice(0, limit),
    byRelativeGrowth: [...ranked]
      .sort((a, b) => (b.relativeGrowth ?? -1) - (a.relativeGrowth ?? -1))
      .slice(0, limit),
  }
}

/** Shortens to `length`, cutting on a word boundary where there is one. */
function truncate(text: string, length: number): string {
  if (text.length <= length) return text

  const cut = text.slice(0, length)
  const lastSpace = cut.lastIndexOf(" ")
  // Only respect the word boundary if it is not so early that the result would
  // be mostly whitespace, which happens with a long unbroken token.
  const body = lastSpace > length * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${body.trimEnd()}...`
}

/** Rounds to `places` decimals, avoiding the float noise of a bare multiply. */
function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
