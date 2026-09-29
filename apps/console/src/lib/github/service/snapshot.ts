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
 * lives in its own table. See `repoWeeklyStars` in the schema.
 */

import { and, eq, sql } from "drizzle-orm"
import {
  repoWeeklyStars,
  snapshots,
  type SnapshotMonth,
} from "@/db/schema"
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
  const counts = new Map<number, { year: number; month: number; count: number }>()

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

  const counts = new Map(weeks.map((week) => [weekKey(week.yearWeek), week.total]))

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
  return previous.month === 12 && next.month === 1 && next.year === previous.year + 1
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
    if (!first || yearWeek.year < first.year ||
      (yearWeek.year === first.year && yearWeek.week < first.week)) {
      first = yearWeek
    }
    if (!last || yearWeek.year > last.year ||
      (yearWeek.year === last.year && yearWeek.week > last.week)) {
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

export type { SnapshotRow }
