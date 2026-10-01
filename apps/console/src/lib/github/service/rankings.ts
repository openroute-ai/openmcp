/**
 * Star rankings for a period.
 *
 * The source app had two near-identical task files, one for weeks and one for
 * months, differing only in which delta helper they called and how they named
 * the output file. This is that computation once, parameterised by period, so
 * the two cannot drift apart.
 *
 * Where the numbers come from is not a detail, though. Both periods now read the
 * same way, because both are stored: the weekly table carries the per-week split
 * that a week straddling the 1st makes unrecoverable from monthly rows, and both
 * tables carry the change next to the level instead of leaving each reader to
 * subtract two rows and guess what a missing row meant.
 *
 * A period with no data yields empty lists rather than zeros, so a missing week
 * cannot publish a ranking claiming nothing moved. A repository whose previous
 * period has no stored level is left out for the same reason: relative growth
 * divides by the count before the period, and with no count to divide by every
 * newly-tracked repository would rank as infinitely fast.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm"
import {
  projects,
  projectsToTags,
  repoMonthlyStats,
  repos,
  repoWeeklyStats,
  tags,
} from "@/db/schema"
import {
  periodFromMonth,
  periodFromWeek,
  previousIsoWeek,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
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
  /**
   * Marks for the row, in the order they should be preferred. All null is
   * normal and falls back to the project's initials.
   *
   * Published in the JSON endpoints too: a consumer rendering the list needs the
   * mark to make it readable, and an additive field is a smaller change for them
   * than a second endpoint that answers the same question differently.
   */
  logo: string | null
  iconUrl: string | null
  /** The owner's GitHub avatar, between the logo and the repository icon. */
  avatar: string | null
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
  const measured = await measurePeriod(
    db,
    repoWeeklyStats,
    periodFromWeek(yearWeek),
    periodFromWeek(previousIsoWeek(yearWeek))
  )

  // Nothing was recorded for the week, so publishing would overwrite a good
  // ranking with one claiming the world stood still. The build task keys its
  // "keep the previous file" decision off an empty result.
  if (measured.length === 0) {
    return {
      period: "week",
      year: yearWeek.year,
      week: yearWeek.week,
      trending: [],
      byRelativeGrowth: [],
    }
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
  const measured = await measurePeriod(
    db,
    repoMonthlyStats,
    periodFromMonth(yearMonth),
    periodFromMonth(previousMonth(yearMonth))
  )

  return assemble(db, {
    period: "month",
    year: yearMonth.year,
    month: yearMonth.month,
    measured,
    limit: options.limit ?? DEFAULT_LIMIT,
  })
}

/** The month before a given one, across the year boundary. */
export function previousMonth({ year, month }: YearMonth): YearMonth {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 }
}

/**
 * A period's movement, for every repository that has both halves stored.
 *
 * `previous` is read only to establish that a comparable period exists. The
 * movement itself comes from the row's own stored `delta_stars`, and the count
 * before the period is recovered from the same row as `total_stars` minus that
 * delta — which avoids a second subtraction against a row that may have been
 * written by a different collector between the two reads.
 *
 * A row whose stored change is negative is skipped: a falling count is a
 * correction or a transfer rather than a declining riser, and ranking it as a
 * large negative delta would put it nowhere useful while making the "trending"
 * list misleading.
 */
async function measurePeriod(
  db: Db,
  table: typeof repoWeeklyStats | typeof repoMonthlyStats,
  period: Date,
  previous: Date
): Promise<Measured[]> {
  const current = await db
    .select({
      repoId: table.repoId,
      totalStars: table.totalStars,
      deltaStars: table.deltaStars,
    })
    .from(table)
    .where(eq(table.period, period))

  if (current.length === 0) return []

  const anchored = new Set(
    (
      await db
        .select({ repoId: table.repoId })
        .from(table)
        .where(eq(table.period, previous))
    ).map((row) => row.repoId)
  )

  const measured: Measured[] = []
  for (const row of current) {
    // No row for the previous period means the period before was never
    // measured, so this one has nothing to be measured against. Reporting it
    // with a `before` of zero would rank every newly-tracked repository as
    // infinitely fast.
    if (!anchored.has(row.repoId)) continue
    if (row.totalStars === null || row.deltaStars === null) continue
    if (row.deltaStars < 0) continue

    measured.push({
      repoId: row.repoId,
      stars: row.totalStars,
      delta: row.deltaStars,
      before: row.totalStars - row.deltaStars,
    })
  }

  return measured
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
      owner: repos.owner,
      createdAt: repos.createdAt,
      projectId: projects.id,
      projectName: projects.name,
      projectDescription: projects.description,
      logo: projects.logo,
      iconUrl: repos.iconUrl,
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
      owner: string
      createdAt: Date
      projectName: string
      projectDescription: string
      logo: string | null
      iconUrl: string | null
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
      owner: row.owner,
      createdAt: row.createdAt,
      projectName: row.projectName,
      projectDescription: row.projectDescription,
      logo: row.logo,
      iconUrl: row.iconUrl,
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
      logo: project.logo,
      iconUrl: project.iconUrl,
      avatar: githubAvatarUrl(project.owner, { ownerId: project.ownerId }),
    })
  }

  return {
    ...header,
    trending: [...ranked].sort((a, b) => b.delta - a.delta).slice(0, limit),
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
