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

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import {
  type AnomalyKind,
  type AnomalySeverity,
  projects,
  projectsToTags,
  repoAnomalies,
  repoDailyStats,
  repoMonthlyStats,
  repos,
  repoWeeklyStats,
  tags,
} from "@/db/schema"
import {
  periodFromDay,
  periodFromMonth,
  periodFromWeek,
  previousIsoWeek,
  type CivilDate,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { NO_DESCRIPTION } from "@/lib/github/service/project"
import type { Db } from "@/lib/github/service/repo"
import { civilOf } from "@/lib/time"

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
  /**
   * The open anomaly on this project, when it has one.
   *
   * A ranking that only counts gains is a ranking that cannot report a decline,
   * and §5.9.3 wants the flag on the list rather than behind a click: the row is
   * the cheapest place to say "this project is also doing badly". One flag per
   * project rather than a list, because a row showing three badges is a row
   * nobody reads the numbers on — the most severe wins.
   */
  anomaly: RankedAnomaly | null
}

/** The single most severe open anomaly on a ranked row. */
export interface RankedAnomaly {
  kind: AnomalyKind
  severity: AnomalySeverity
  title: string
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

/**
 * One calendar day's board, as a day rather than as a ranking period.
 *
 * A separate interface rather than a third `Rankings.period` member because
 * `Rankings` is the shape `/api/v1/rankings/*` publishes and
 * `rankingsSchema` pins `period` to `week | month`. Widening that union to
 * carry a period the authenticated API does not serve would make the contract
 * describe a value no client of it can receive.
 */
export interface DailyRankings {
  period: "day"
  /** The Asia/Shanghai calendar day, as `YYYY-MM-DD`. */
  day: string
  trending: RankedProject[]
  byRelativeGrowth: RankedProject[]
  /**
   * How many projects carried both a row for this day and one for the day
   * before it — the denominator behind both lists.
   *
   * Carried on the board because a daily list can be a partial write, and a
   * caller reading three entries cannot otherwise tell "the top three of the
   * day" from "the three entries a partial run happened to produce". The
   * weekly and monthly boards do not need it: their writer runs once per
   * completed period, so the newest row is always the whole period.
   */
  projectsMeasured: number
}

/** The part of a board that says which period it is about. */
type BoardHeader = {
  period: "day" | "week" | "month"
  year?: number
  week?: number
  month?: number
  day?: string
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
    header: {
      period: "week",
      year: yearWeek.year,
      week: yearWeek.week,
    },
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
    header: {
      period: "month",
      year: yearMonth.year,
      month: yearMonth.month,
    },
    measured,
    limit: options.limit ?? DEFAULT_LIMIT,
  })
}

/**
 * One calendar day's board.
 *
 * The daily stats table was already collected — the public project chart reads
 * 90 days of it — so this is the same measure-then-assemble pipeline as the
 * weekly and monthly boards pointed at a finer table rather than a fourth
 * implementation of "which projects gained the most".
 *
 * A day is a genuinely noisier unit than a week: most repositories gain nothing
 * on any given day, and the top of the list is dominated by whichever ones
 * happened to get a link. That is why the public page and the build task publish
 * weekly and monthly boards, and why this one exists for an agent that asked
 * for "yesterday" rather than as a page a human is pointed at.
 */
export async function buildRankingsForDay(
  db: Db,
  day: CivilDate,
  options: BuildOptions = {}
): Promise<DailyRankings> {
  const start = periodFromDay(day)
  // The previous day is derived from the instant, not by subtracting from the
  // calendar fields: day 1 of a month has no day 0, and a month boundary is
  // exactly where a naive subtraction lands in the previous month.
  const previous = periodFromDay(
    civilOf(new Date(start.getTime() - 86_400_000))
  )

  const measured = await measurePeriod(db, repoDailyStats, start, previous)

  const assembled = await assemble(db, {
    header: {
      period: "day",
      day: `${day.year}-${pad(day.month)}-${pad(day.day)}`,
    },
    measured,
    limit: options.limit ?? DEFAULT_LIMIT,
  })

  return { ...assembled, projectsMeasured: measured.length }
}

/**
 * The most recent day the daily table has rows for.
 *
 * "Yesterday" is the wrong default for this table. The weekly and monthly rows
 * are written once per completed period, so the newest row is always a full
 * period; daily rows are written by a sampler that runs on its own schedule, so
 * the newest day is usually two or three days old and the day after it may hold
 * only a handful of rows from a partial run.
 *
 * That partial run is why this returns the newest day *that has rows* and why
 * the caller is expected to report how many it found: defaulting to yesterday
 * answers "no data" most of the time, and defaulting to a 12-row day would
 * present a partial write as a ranking of the world.
 *
 * An index-only backward scan of the period index, so the cost is one page read
 * rather than a scan of the table.
 */
export async function latestDailyPeriod(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ period: repoDailyStats.period })
    .from(repoDailyStats)
    .orderBy(desc(repoDailyStats.period))
    .limit(1)
  return rows[0]?.period ?? null
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
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
  table:
    typeof repoWeeklyStats | typeof repoMonthlyStats | typeof repoDailyStats,
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
async function assemble<T extends BoardHeader>(
  db: Db,
  input: {
    header: T
    measured: Measured[]
    limit: number
  }
): Promise<
  { trending: RankedProject[]; byRelativeGrowth: RankedProject[] } & T
> {
  const { header, measured, limit } = input

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

  // One read for every open anomaly touching this page's rows, rather than a
  // lookup per project: a page of twelve rows would otherwise cost twelve extra
  // round trips to answer a question whose answer is almost always "none".
  const flags = await mostSevereAnomalies(db, [...counts.keys()])

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
      anomaly: flags.get(project.repoId) ?? null,
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

/**
 * The most severe open anomaly per repository, for the repositories given.
 *
 * "Most severe" rather than "most recent": a project that just changed its
 * licence is worth less attention this week than one that has been falling for a
 * month, and a row badge is read once — it has to carry the thing that matters
 * most, not the thing that happened most recently. The `good` rows are excluded
 * for the same reason the feed excludes them: an acceleration badge on a
 * leaderboard would be read as a warning about the row.
 */
async function mostSevereAnomalies(
  db: Db,
  repoIds: string[]
): Promise<Map<string, RankedAnomaly>> {
  if (repoIds.length === 0) return new Map()

  const rows = await db
    .select({
      repoId: repoAnomalies.repoId,
      kind: repoAnomalies.kind,
      severity: repoAnomalies.severity,
      title: repoAnomalies.title,
      detectedAt: repoAnomalies.detectedAt,
    })
    .from(repoAnomalies)
    .where(
      and(
        inArray(repoAnomalies.repoId, repoIds),
        eq(repoAnomalies.status, "open"),
        ne(repoAnomalies.severity, "good")
      )
    )
    .orderBy(desc(repoAnomalies.detectedAt))

  const SEVERITY_ORDER: Record<string, number> = { down: 3, risk: 2, notice: 1 }
  const best = new Map<
    string,
    { anomaly: RankedAnomaly; rank: number; at: Date }
  >()

  for (const row of rows) {
    const rank = SEVERITY_ORDER[row.severity] ?? 0
    const current = best.get(row.repoId)
    // Ties broken by recency, so the badge on a project with two open rows is
    // the newer of the two rather than an arbitrary one.
    if (
      !current ||
      rank > current.rank ||
      (rank === current.rank && row.detectedAt > current.at)
    ) {
      best.set(row.repoId, {
        anomaly: {
          kind: row.kind as AnomalyKind,
          severity: row.severity as AnomalySeverity,
          title: row.title,
        },
        rank,
        at: row.detectedAt,
      })
    }
  }

  return new Map(
    [...best.entries()].map(([repoId, entry]) => [repoId, entry.anomaly])
  )
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
