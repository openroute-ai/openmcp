/**
 * Star history.
 *
 * Two shapes, because two questions get asked of it. A snapshot row holds one
 * year with the months stored as a JSONB array, so a year is read and written
 * as a single row instead of a row per month. Writes therefore merge rather
 * than replace: two different collectors (stargazers and npm downloads)
 * contribute different fields to the same month, and neither may erase the
 * other's contribution.
 *
 * The monthly rows cannot answer a weekly question, so the per-ISO-week split
 * lives in its own table. See `repoWeeklyStars` in the schema. The per-day split
 * for the public detail chart lives in `repo_daily_stars`, over a rolling
 * window rather than the whole history.
 */

import { and, asc, eq, gte, lte, sql } from "drizzle-orm"
import { repoDailyStars, repoWeeklyStars, snapshots, type SnapshotMonth } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import {
  getIsoWeekNumber,
  isInIsoWeek,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"

type SnapshotRow = typeof snapshots.$inferSelect

/** Fields a collector may contribute to a month. */
export type MonthContribution = Partial<Omit<SnapshotMonth, "month" | "year">>

export interface StargazerStamp {
  starredAt: string
}

/** Optional totals a month may carry, beyond its star count. */
const OPTIONAL_TOTALS = [
  "totalDownloads",
  "totalContributors",
  "totalPullRequests",
  "totalReleases",
] as const

/**
 * Replaces the month's entry, or appends it when the year is new.
 *
 * Months are kept sorted by number so a year reads chronologically without
 * the caller having to sort it.
 */
export function mergeMonth(
  months: SnapshotMonth[],
  yearMonth: YearMonth,
  contribution: MonthContribution
): SnapshotMonth[] {
  const existing = months.find(
    (entry) => entry.year === yearMonth.year && entry.month === yearMonth.month
  )

  const merged: SnapshotMonth = {
    month: yearMonth.month,
    year: yearMonth.year,
    stars: contribution.stars ?? existing?.stars ?? 0,
  }

  // An optional total is overwritten only when this collector supplied one,
  // so a stargazer run cannot blank the npm downloads already recorded, and
  // a download run cannot blank the stargazer-derived totals.
  for (const field of OPTIONAL_TOTALS) {
    const value = contribution[field] ?? existing?.[field]
    if (value !== undefined) merged[field] = value
  }

  return [
    ...months.filter(
      (entry) =>
        !(entry.year === yearMonth.year && entry.month === yearMonth.month)
    ),
    merged,
  ].sort((a, b) => a.year - b.year || a.month - b.month)
}

/**
 * Turns stargazer timestamps into a per-month star total.
 *
 * GitHub only ever reports *when* someone starred, so the count within a
 * month is a cumulative running total of everyone who had starred by the end
 * of that month. Returning the running total is what makes month-over-month
 * deltas meaningful; returning the number of stargazers per month would
 * make a repository with steady growth look flat.
 */
export function accumulateStarsByMonth(
  stamps: StargazerStamp[]
): { yearMonth: YearMonth; stars: number }[] {
  const counts = new Map<
    number,
    { year: number; month: number; count: number }
  >()

  for (const stamp of stamps) {
    const date = new Date(stamp.starredAt)
    if (Number.isNaN(date.getTime())) continue
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const key = year * 100 + month
    const entry = counts.get(key) ?? { year, month, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }

  const ordered = [...counts.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month
  )

  let running = 0
  return ordered.map((entry) => {
    running += entry.count
    return {
      yearMonth: { year: entry.year, month: entry.month },
      stars: running,
    }
  })
}

export async function getSnapshot(
  db: Db,
  repoId: string,
  year: number
): Promise<SnapshotRow | undefined> {
  return db.query.snapshots.findFirst({
    where: and(eq(snapshots.repoId, repoId), eq(snapshots.year, year)),
  })
}

export async function listSnapshots(
  db: Db,
  repoId: string
): Promise<SnapshotRow[]> {
  return db
    .select()
    .from(snapshots)
    .where(eq(snapshots.repoId, repoId))
    .orderBy(snapshots.year)
}

export async function listAllSnapshots(db: Db): Promise<SnapshotRow[]> {
  return db.select().from(snapshots).orderBy(snapshots.year)
}

/** Repositories that have any recorded history. */
export async function listSnapshottedRepoIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ repoId: snapshots.repoId })
    .from(snapshots)
  return rows.map((row) => row.repoId)
}

/**
 * Merges a contribution into a month, creating the year row if needed.
 *
 * A transaction alone is not enough here. Two collectors writing the same
 * year both read the row, both compute a merge from it, and both write - so
 * whichever commits second overwrites the other's field. The transaction does
 * not stop that, because neither read has seen the other's uncommitted write.
 *
 * The fix is an advisory lock keyed on the repository and year, taken before
 * the read and released when the transaction ends. The second collector
 * blocks on it, then re-reads a row that already includes the first
 * collector's field, so nothing is lost. `pg_advisory_xact_lock` releases
 * automatically on commit, rollback, or a dropped connection, so a failed
 * write cannot wedge the year.
 *
 * The lock is per (repo, year) rather than global so unrelated repositories
 * are still recorded in parallel, and it is a database lock rather than an
 * in-process one so it also serialises collectors running on different Vercel
 * instances.
 */
export async function recordMonth(
  db: Db,
  repoId: string,
  yearMonth: YearMonth,
  contribution: MonthContribution
): Promise<void> {
  await db.transaction(async (tx) => {
    // hashtext gives a stable int4 from the key, so the same repo and year
    // always take the same lock across processes and restarts.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`openmcp:snapshot:${repoId}:${yearMonth.year}`}))`
    )

    const existing = await tx.query.snapshots.findFirst({
      where: and(
        eq(snapshots.repoId, repoId),
        eq(snapshots.year, yearMonth.year)
      ),
    })

    const months = mergeMonth(existing?.months ?? [], yearMonth, contribution)

    if (existing) {
      await tx
        .update(snapshots)
        .set({ months, updatedAt: new Date() })
        .where(
          and(eq(snapshots.repoId, repoId), eq(snapshots.year, yearMonth.year))
        )
    } else {
      await tx.insert(snapshots).values({
        repoId,
        year: yearMonth.year,
        months,
      })
    }
  })
}

/**
 * Records the star total for every month covered by a stargazer sweep.
 *
 * Only months within the sweep's own range are written. A repository that
 * predates the sweep has no stargazer history to backfill, and inventing a
 * zero for those months would show as a cliff in the trend.
 */
export async function recordStarsFromStargazers(
  db: Db,
  repoId: string,
  stamps: StargazerStamp[]
): Promise<number> {
  const byMonth = accumulateStarsByMonth(stamps)
  for (const { yearMonth, stars } of byMonth) {
    await recordMonth(db, repoId, yearMonth, { stars })
  }
  return byMonth.length
}

export function monthAt(
  row: SnapshotRow,
  yearMonth: YearMonth
): SnapshotMonth | undefined {
  return row.months?.find(
    (entry) => entry.year === yearMonth.year && entry.month === yearMonth.month
  )
}

/** Every month in a repository's history, oldest first. */
export function flattenMonths(rows: SnapshotRow[]): SnapshotMonth[] {
  return rows
    .flatMap((row) => row.months ?? [])
    .sort((a, b) => a.year - b.year || a.month - b.month)
}

/**
 * Records the stargazers gained in each ISO week covered by a sweep.
 *
 * Written from the same sweep that fills the monthly rows, because the monthly
 * rows cannot answer a weekly question: a week that straddles the 1st is split
 * across two months and no combination of them recovers the week's real gain.
 * The raw timestamps are gone once the sweep finishes, so this is the only
 * point at which the split is knowable.
 *
 * Only weeks within the sweep's own range are written, and a week the sweep
 * covered with zero stargazers is recorded as zero rather than skipped, so a
 * flat week reads as flat instead of as missing data.
 *
 * Replaces rather than appends, so a repository renamed or re-swept converges
 * instead of keeping a stale count.
 */
export async function recordWeeklyStarsFromStargazers(
  db: Db,
  repoId: string,
  stamps: StargazerStamp[]
): Promise<number> {
  const weeks = computeWeeklyTrend(stamps)
  if (weeks.length === 0) return 0

  const first = weeks[0]!.yearWeek
  const last = weeks[weeks.length - 1]!.yearWeek

  // Every week the sweep spanned, including the empty ones between the first
  // and last stargazer. Skipping them would make a repository that gained
  // nothing for a month look as though it had no data for it.
  const covered: { year: number; week: number }[] = []
  for (let year = first.year; year <= last.year; year++) {
    const fromWeek = year === first.year ? first.week : 1
    const toWeek = year === last.year ? last.week : weeksInYear(year)
    for (let week = fromWeek; week <= toWeek; week++) {
      covered.push({ year, week })
    }
  }

  const counts = new Map(
    weeks.map((week) => [weekKey(week.yearWeek), week.total])
  )

  // Replaced wholesale rather than range-deleted. A sweep always covers a
  // repository's whole stargazer history, so every row this repository owns is
  // in scope, and a range predicate would have to compare (year, week) tuples
  // against a table that stores no date. This also drops weeks a re-sweep no
  // longer spans, which a range delete would leave behind as stale zeros.
  await db.delete(repoWeeklyStars).where(eq(repoWeeklyStars.repoId, repoId))

  for (const { year, week } of covered) {
    await db.insert(repoWeeklyStars).values({
      repoId,
      year,
      week,
      stars: counts.get(year * 100 + week) ?? 0,
    })
  }

  return covered.length
}

function weekKey({ year, week }: YearWeek): number {
  return year * 100 + week
}

/**
 * How many days of daily history the sweep keeps.
 *
 * A sweep reads a repository's entire stargazer list, so the daily split is
 * derivable for all of it — but storing all of it is the wrong trade. The only
 * reader is the public project detail chart, which shows a trailing window, and
 * a decade-old repository would otherwise contribute 3650 rows for a few hundred
 * days that actually have stargazers. 90 days covers the chart and roughly a
 * quarter, which is also long enough to spot a seasonal pattern.
 */
export const DAILY_STARS_WINDOW_DAYS = 90

/** A UTC calendar day, as `YYYY-MM-DD`. */
function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return toDayKey(date)
}

export interface DailyStarWindow {
  /** Non-empty days to store, ascending. */
  rows: { day: string; stars: number }[]
  /** First day of the window, which has no row when nothing happened on it. */
  firstDay: string
  /** Last day of the window, which is the newest stargazer's day. */
  lastDay: string
}

/**
 * Picks the daily rows to store: the non-empty days inside the trailing window,
 * ascending, plus the window's own bounds.
 *
 * The window is keyed off the newest stargazer rather than the clock, so a
 * repository nobody has starred in a month still records the month leading up to
 * its last star instead of writing a single row for today.
 *
 * The bounds are returned alongside the rows because they are not the same span:
 * the window starts `DAILY_STARS_WINDOW_DAYS` before the newest stargazer, which
 * is a day that may well have no row. A rewrite has to clear the whole window,
 * not just the days that still have stargazers, or a day that *lost* its stars
 * since the last sweep would survive as a stale row and stretch the chart's axis
 * back over a window the repository no longer has data for.
 */
export function selectDailyStarWindow(
  stamps: StargazerStamp[]
): DailyStarWindow | undefined {
  const perDay = new Map<string, number>()

  for (const stamp of stamps) {
    const date = new Date(stamp.starredAt)
    if (Number.isNaN(date.getTime())) continue
    const day = toDayKey(date)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }

  if (perDay.size === 0) return undefined

  const lastDay = [...perDay.keys()].sort().at(-1)!
  const firstDay = addDays(lastDay, -(DAILY_STARS_WINDOW_DAYS - 1))

  const rows = [...perDay.entries()]
    .filter(([day]) => day >= firstDay)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, stars]) => ({ day, stars }))

  return { rows, firstDay, lastDay }
}

/**
 * Records new stargazers per UTC day, for the trailing `DAILY_STARS_WINDOW_DAYS`.
 *
 * Only non-empty days are written, unlike the weekly writer above which fills
 * the gaps between the first and last stargazer. That difference is deliberate:
 * weekly needs the zeros because a week with no stargazers is a *claim* — the
 * project was flat, which is a finding. At day granularity a quiet day is
 * unremarkable and overwhelmingly the common case, so the reader supplies the
 * zeros and the writer stays proportional to real activity.
 *
 * Replaces the window rather than appending, so a re-sweep converges and a day
 * that lost stars is corrected.
 */
export async function recordDailyStarsFromStargazers(
  db: Db,
  repoId: string,
  stamps: StargazerStamp[]
): Promise<number> {
  const window = selectDailyStarWindow(stamps)
  if (!window) return 0

  await db
    .delete(repoDailyStars)
    .where(
      and(
        eq(repoDailyStars.repoId, repoId),
        gte(repoDailyStars.day, window.firstDay),
        lte(repoDailyStars.day, window.lastDay)
      )
    )

  for (const { day, stars } of window.rows) {
    await db.insert(repoDailyStars).values({ repoId, day, stars })
  }

  return window.rows.length
}

export interface DailyStar {
  day: string
  stars: number
}

/**
 * New stargazers per ISO week, ascending, over a trailing number of weeks.
 *
 * The weekly table is stored for a repository's whole history, so a chart asks
 * for a window rather than reading the table: a ten-year-old repository has five
 * hundred rows of which the recent dozen are on screen. The window is taken from
 * the end rather than filtered on a date, because the table stores (year, week)
 * and not a date — see `repoWeeklyStars` in the schema for why.
 */
export async function listWeeklyStars(
  db: Db,
  repoId: string,
  weeks: number = 12
): Promise<{ yearWeek: YearWeek; stars: number }[]> {
  const rows = await db
    .select({
      year: repoWeeklyStars.year,
      week: repoWeeklyStars.week,
      stars: repoWeeklyStars.stars,
    })
    .from(repoWeeklyStars)
    .where(eq(repoWeeklyStars.repoId, repoId))
    .orderBy(
      asc(repoWeeklyStars.year),
      asc(repoWeeklyStars.week)
    )

  return rows
    .slice(-weeks)
    .map((row) => ({
      yearWeek: { year: row.year, week: row.week },
      stars: row.stars,
    }))
}

/**
 * The stored daily rows inside a window, ascending, with gaps filled as zeros.
 *
 * The window is `[newest stored day - days + 1, newest stored day]` rather than
 * the last `days` calendar days, so a repository that stopped getting stars
 * returns its last 90 days instead of a flat line of zeros stretching to today.
 * That means the chart is always as long as there is data for, and the caller
 * can date the axis from the data rather than from the clock.
 *
 * Returns an empty array when nothing is stored, which is a real state rather
 * than an error: the table only fills as repositories are swept.
 */
export async function getDailyStars(
  db: Db,
  repoId: string,
  days: number = DAILY_STARS_WINDOW_DAYS
): Promise<DailyStar[]> {
  const rows = await db
    .select({ day: repoDailyStars.day, stars: repoDailyStars.stars })
    .from(repoDailyStars)
    .where(eq(repoDailyStars.repoId, repoId))
    .orderBy(asc(repoDailyStars.day))

  const stored = rows.map((row) => ({ day: row.day, stars: row.stars }))
  if (stored.length === 0) return []

  const counts = new Map(stored.map((row) => [row.day, row.stars]))
  const last = stored[stored.length - 1]!.day
  const first = addDays(last, -(days - 1))

  const dense: DailyStar[] = []
  for (let day = first; day <= last; day = addDays(day, 1)) {
    dense.push({ day, stars: counts.get(day) ?? 0 })
  }
  return dense
}

function weeksInYear(year: number): number {
  // An ISO year has 53 weeks when the year is short a day for the last week
  // to close, which happens when 1 January is a Thursday or when it is a
  // Wednesday leap year. December 28 is always in the last ISO week of its
  // year, so asking the ISO arithmetic directly is exact where a weekday
  // heuristic has to remember both rules.
  const december28 = new Date(Date.UTC(year, 11, 28))
  return getIsoWeekNumber(december28).week === 53 ? 53 : 52
}

export interface Trend {
  /** The window the delta covers. */
  yearMonth: YearMonth
  /** Growth over the window, or undefined when the window has no history. */
  delta: number | undefined
  /** The value at the end of the window. */
  total: number
}

/** True when two months are consecutive, across a year boundary included. */
export function isConsecutiveMonth(
  previous: YearMonth,
  next: YearMonth
): boolean {
  if (next.year === previous.year) return next.month === previous.month + 1
  // December is followed by January of the following year; a December in one
  // year and a January in any other is not consecutive.
  return (
    previous.month === 12 && next.month === 1 && next.year === previous.year + 1
  )
}

/**
 * Computes growth across consecutive months.
 *
 * The first month has no predecessor, so its delta is undefined rather than
 * equal to its own total. Reporting it as growth would show a repository
 * appearing out of nowhere as a single month's gain.
 */
export function computeMonthlyTrend(
  history: SnapshotMonth[],
  field: "stars" | "totalDownloads" = "stars"
): Trend[] {
  return history.map((entry, index) => {
    const previous = index > 0 ? history[index - 1] : undefined
    // Only compare against the immediately preceding month; a gap in the
    // history means the change spans more than a month and is not a
    // month-over-month figure.
    const contiguous =
      previous !== undefined &&
      isConsecutiveMonth(
        { year: previous.year, month: previous.month },
        { year: entry.year, month: entry.month }
      )

    const total = entry[field] ?? 0
    return {
      yearMonth: { year: entry.year, month: entry.month },
      delta: contiguous ? total - (previous![field] ?? 0) : undefined,
      total,
    }
  })
}

export interface WeekTrend {
  yearWeek: YearWeek
  /** Change in new stargazers versus the previous ISO week. */
  delta: number | undefined
  /** Stargazers gained during this ISO week. */
  total: number
}

/**
 * Computes stargazers per ISO week from a sweep.
 *
 * Built from the raw timestamps rather than from the monthly snapshot,
 * because a week cuts across month boundaries and the monthly row cannot
 * answer the question on its own.
 *
 * Note the totals here are per-week *gains*, not a running total, because
 * that is what a sweep can reconstruct from timestamps alone. The monthly
 * series in `computeMonthlyTrend` is cumulative; use it for a running total
 * and this one to see a week accelerating or losing momentum.
 */
export function computeWeeklyTrend(stamps: StargazerStamp[]): WeekTrend[] {
  const perWeek = new Map<number, { yearWeek: YearWeek; count: number }>()

  for (const stamp of stamps) {
    const date = new Date(stamp.starredAt)
    if (Number.isNaN(date.getTime())) continue
    const yearWeek = getIsoWeekNumber(date)
    const key = yearWeek.year * 100 + yearWeek.week
    const entry = perWeek.get(key) ?? { yearWeek, count: 0 }
    entry.count += 1
    perWeek.set(key, entry)
  }

  const ordered = [...perWeek.values()].sort(
    (a, b) =>
      a.yearWeek.year - b.yearWeek.year || a.yearWeek.week - b.yearWeek.week
  )

  return ordered.map((entry, index) => ({
    yearWeek: entry.yearWeek,
    delta: index > 0 ? entry.count - ordered[index - 1]!.count : undefined,
    total: entry.count,
  }))
}

/** Weeks covered by a stargazer sweep, for progress reporting. */
export function sweepWeekRange(
  stamps: StargazerStamp[]
): { first: YearWeek; last: YearWeek } | undefined {
  let first: YearWeek | undefined
  let last: YearWeek | undefined

  for (const stamp of stamps) {
    const date = new Date(stamp.starredAt)
    if (Number.isNaN(date.getTime())) continue
    const yearWeek = getIsoWeekNumber(date)
    if (
      !first ||
      yearWeek.year < first.year ||
      (yearWeek.year === first.year && yearWeek.week < first.week)
    ) {
      first = yearWeek
    }
    if (
      !last ||
      yearWeek.year > last.year ||
      (yearWeek.year === last.year && yearWeek.week > last.week)
    ) {
      last = yearWeek
    }
  }

  return first && last ? { first, last } : undefined
}

/** Stargazers that fell inside a given ISO week. */
export function stampsInWeek(
  stamps: StargazerStamp[],
  yearWeek: YearWeek
): StargazerStamp[] {
  return stamps.filter((stamp) => {
    const date = new Date(stamp.starredAt)
    return !Number.isNaN(date.getTime()) && isInIsoWeek(date, yearWeek)
  })
}

/**
 * The last `count` months, oldest first, ending with the month before `today`.
 *
 * Ends on the previous month rather than the current one because a month is
 * only complete at its end: charting the current month would draw a bar that
 * is short for a reason that has nothing to do with the project, and would
 * move every time the page was reloaded.
 */
export function lastNMonths(count: number, today: Date): YearMonth[] {
  const months: YearMonth[] = []
  // Counts back from the first of this month, which is already one step past
  // the month before it. The cursor is pinned to day one on purpose:
  // `setUTCMonth` keeps the day of the month, so stepping back from 31 May
  // aims at 31 April, and a date that does not exist overflows forward into May
  // again — which would chart the same month twice and drop one from the end.
  const cursor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  )
  for (let index = 0; index < count; index++) {
    cursor.setUTCMonth(cursor.getUTCMonth() - 1)
    months.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
    })
  }
  return months.reverse()
}

/** One bar: growth over a month, and the total that month closed at. */
export interface MonthlyBar {
  yearMonth: YearMonth
  /**
   * Growth over the month, or undefined when there is no history to measure it
   * against. Undefined is not zero: a month with no prior month has an unknown
   * delta, and drawing it as a flat bar would read as a project that stopped
   * growing.
   */
  delta: number | undefined
  total: number
}

/**
 * Month-over-month growth for the last `count` months.
 *
 * Months with no data are left in as `undefined` rather than dropped, so the
 * chart keeps a gap where the history has a gap. A dropped month is
 * indistinguishable from a month of zero growth, and a repository that was
 * never swept would chart as a project that stopped earning stars.
 */
export function monthlyBars(
  months: SnapshotMonth[],
  count: number,
  today: Date
): MonthlyBar[] {
  const byMonth = new Map(
    months.map((entry) => [entry.year * 100 + entry.month, entry])
  )
  const trends = new Map(
    computeMonthlyTrend(
      [...months].sort((a, b) => a.year - b.year || a.month - b.month)
    ).map((trend) => [
      trend.yearMonth.year * 100 + trend.yearMonth.month,
      trend,
    ])
  )

  return lastNMonths(count, today).map((yearMonth) => {
    const key = yearMonth.year * 100 + yearMonth.month
    const recorded = byMonth.get(key)
    const trend = trends.get(key)
    return {
      yearMonth,
      delta: recorded ? trend?.delta : undefined,
      total: recorded ? (trend?.total ?? 0) : 0,
    }
  })
}

export interface PeriodTrends {
  /** Stargazers gained in the most recent ISO week the sweep recorded. */
  week: number | undefined
  /** Growth over the most recent month with a predecessor. */
  month: number | undefined
  /** Growth over the twelve months ending with the most recent one. */
  year: number | undefined
  /** The most recent month's closing total. */
  total: number | undefined
}

/**
 * The headline growth figures, over the windows the stored history supports.
 *
 * Every figure is a delta against a *recorded* month rather than a difference
 * between the latest month and the calendar today. The history is written by a
 * stargazer sweep, so its last month can be any month in the past; subtracting
 * it from today would report a project as having gained every star it has
 * gained since it was last swept, in a single recent window.
 *
 * A window with no comparable history is `undefined` rather than zero, so the
 * page can say it is unknown instead of reporting that nothing happened.
 *
 * `weekly` is passed in rather than derived here because the weekly figure
 * cannot come from the monthly rows: a week that straddles two months is not
 * recoverable from them, which is why the sweep records the split separately.
 */
export function periodTrends(
  months: SnapshotMonth[],
  weekly?: { year: number; week: number; stars: number }[]
): PeriodTrends {
  const ordered = [...months].sort(
    (a, b) => a.year - b.year || a.month - b.month
  )
  const last = ordered[ordered.length - 1]
  if (!last) {
    return {
      week: weekly ? latestWeekGain(weekly) : undefined,
      month: undefined,
      year: undefined,
      total: undefined,
    }
  }

  const trends = computeMonthlyTrend(ordered)
  const lastTrend = trends[trends.length - 1]
  const yearAgo = trends.find(
    (trend) =>
      trend.yearMonth.year === last.year - 1 &&
      trend.yearMonth.month === last.month
  )

  return {
    week: weekly ? latestWeekGain(weekly) : undefined,
    month: lastTrend?.delta,
    year:
      lastTrend && yearAgo ? lastTrend.total - (yearAgo.total ?? 0) : undefined,
    total: lastTrend?.total,
  }
}

/**
 * Stargazers gained in the most recent ISO week recorded for a repository.
 *
 * Read from the weekly table, which stores a gain per week rather than a
 * running total, so the figure is already the window's growth. Undefined when
 * the repository has no weekly history, which is every repository whose sweep
 * predates the table or that has never been swept.
 */
export function latestWeekGain(
  weeks: { year: number; week: number; stars: number }[]
): number | undefined {
  let latest: { year: number; week: number } | undefined
  for (const row of weeks) {
    if (
      !latest ||
      row.year > latest.year ||
      (row.year === latest.year && row.week > latest.week)
    ) {
      latest = { year: row.year, week: row.week }
    }
  }
  if (!latest) return undefined
  return weeks.find(
    (row) => row.year === latest!.year && row.week === latest!.week
  )?.stars
}

/** The last `count` ISO weeks, oldest first, ending with the one containing `today`. */
export function lastNWeeks(count: number, today: Date): YearWeek[] {
  const weeks: YearWeek[] = []
  const cursor = new Date(today.getTime())
  for (let index = 0; index < count; index++) {
    weeks.push(getIsoWeekNumber(cursor))
    cursor.setUTCDate(cursor.getUTCDate() - 7)
  }
  return weeks.reverse()
}

export type { SnapshotRow }
