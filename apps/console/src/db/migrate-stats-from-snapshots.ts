/**
 * Derives console's three stats tables from the `snapshots` rows the source
 * database carried over.
 *
 * `snapshots` is the only statistics the legacy database has: one row per
 * repository per year, holding a `months` array of the days somebody actually
 * read that repository's counters — `stars`, `watchers`, `forks`, `releases`,
 * `pullRequests`. Console never reads that table. Its rankings, the project
 * detail chart and the headline trends read `repo_daily_stats`,
 * `repo_weekly_stats` and `repo_monthly_stats`, so until they are filled the
 * migrated catalogue renders with every growth figure blank.
 *
 * What those readings are is a sample, not a series: a repository is read on
 * some days and not others, and the median one is read twenty times a year. So
 * the rules below are the ones a sampled counter admits to, and they are the
 * rules the console's own writers already follow:
 *
 * - **Levels are carried forward.** A row's `total_*` is the most recent
 *   reading at or before the period ended — the last value anyone actually saw,
 *   not an interpolation between two of them.
 * - **A change is written only for a period that was read.** `delta_*` compares
 *   this period's carried-forward level with the previous period's, and stays
 *   NULL when the period contains no reading. A NULL means "not measured",
 *   which is what it means everywhere else here; a zero would claim the
 *   repository stood still when nobody looked.
 * - **The change lands on the period that was read**, exactly as the daily
 *   sampler does it: that writer compares against the previous *stored* level,
 *   so a collector quiet for six months attributes the whole gap to the period
 *   it resumes in rather than reporting six months of zero growth.
 * - **Nothing is counted that was not counted.** `delta_new_stars` separates
 *   arrivals from departures and a net total cannot be split back into them, so
 *   it stays NULL and readers fall back to `delta_stars`. Open issues, commits,
 *   contributors and downloads were never in a reading either.
 *
 * Days run from a repository's first reading to its last, one row each, because
 * the chart reads a trailing window of rows and dates it by position: ninety
 * sparse rows would span two years and be drawn inside a single quarter. Weeks
 * and months are dense over the same span for a second reason — a ranking
 * refuses a period whose predecessor has no row at all, so an August nobody read
 * still has to exist for September to be ranked against it.
 *
 * A series therefore also gets **one week and one month before its first
 * reading**, carrying that reading's level and no change of its own. It is the
 * only period invented here, and it is what lets a repository first read on 20
 * September be ranked for September at all: its predecessor exists, and the
 * first measured period is compared against the first value anyone saw rather
 * than against nothing. The cost is that the change reported for that first
 * period starts at the first reading, so it understates the part of the period
 * that predates it — which is the safe direction, and the same reason the
 * collectors report NULL rather than the whole count for a repository that
 * appears for the first time.
 *
 * `snapshots` is read from console's own database, where
 * `pnpm db:migrate:from-postgres` put it, so this needs one connection and
 * cannot drift from what was actually migrated.
 *
 *   pnpm db:migrate:stats
 *   pnpm db:migrate:stats -- --force    replace stats already on record
 *
 * It refuses to run over existing stats without `--force`: those rows may have
 * been written by the collectors since the migration, and this would replace
 * measurements with reconstructions.
 */

import { count } from "drizzle-orm"

import { periodStart, type CivilDate } from "@/lib/github/snapshot-dates"
import type { Db } from "@/lib/github/service/repo"
import type { StatsMeasurement } from "@/lib/github/service/stats"
import { loadConsoleEnv } from "./load-env"
import {
  repoDailyStats,
  repoMonthlyStats,
  repoWeeklyStats,
  snapshots,
} from "./schema"

loadConsoleEnv()

/** Milliseconds in a calendar day, the step a dense day range walks. */
const DAY = 86_400_000

/** The counters every reading in `snapshots.months` carries. */
const MEASURED = [
  "stars",
  "watchers",
  "forks",
  "releases",
  "pullRequests",
] as const

type Measured = (typeof MEASURED)[number]

/** The measured counters' levels; absent means the reading did not say. */
type Levels = Partial<Record<Measured, number>>

/** One calendar day's readings for one repository. */
interface Reading {
  /** The calendar day, as UTC midnight of its civil date. */
  day: number
  levels: Levels
}

/** A stats row before it is written. */
interface StatsRow {
  period: Date
  values: StatsMeasurement
}

/** The shape `snapshots.months` actually has: months of daily readings. */
interface RawMonth {
  month?: number
  snapshots?: RawDay[]
}

interface RawDay {
  day?: number
  stars?: number
  watchers?: number
  forks?: number
  releases?: number
  pullRequests?: number
}

/** UTC midnight of a civil date, which is how a day is keyed throughout. */
function dayMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day)
}

/** The civil date a day key names. */
function civilOf(day: number): CivilDate {
  const date = new Date(day)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

/** First day of the ISO week (Monday) containing `day`. */
function weekStartOf(day: number): number {
  const weekday = new Date(day).getUTCDay() || 7
  return day - (weekday - 1) * DAY
}

/** First day of the month containing `day`. */
function monthStartOf(day: number): number {
  const date = new Date(day)
  return dayMs(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

/** Last day of the month containing `day`. */
function monthEndOf(day: number): number {
  const date = new Date(day)
  return dayMs(date.getUTCFullYear(), date.getUTCMonth() + 2, 0)
}

/**
 * Reads one repository's days out of a `months` array, keyed by calendar day.
 *
 * A day read twice keeps the later entry rather than throwing: the source has
 * no duplicates today, and a merge policy that survives a source which grows
 * one is cheaper than a migration that stops after the first conflicting row.
 */
function readingsOf(year: number, months: RawMonth[] | null): Reading[] {
  const byDay = new Map<number, Levels>()

  for (const month of months ?? []) {
    const number = month.month
    if (typeof number !== "number" || number < 1 || number > 12) continue

    for (const entry of month.snapshots ?? []) {
      if (typeof entry.day !== "number" || typeof entry.stars !== "number") {
        continue
      }
      const levels: Levels = {}
      for (const counter of MEASURED) {
        const value = entry[counter]
        if (typeof value === "number") levels[counter] = value
      }
      byDay.set(dayMs(year, number, entry.day), levels)
    }
  }

  return [...byDay.entries()]
    .map(([day, levels]) => ({ day, levels }))
    .sort((a, b) => a.day - b.day)
}

/** The change each measured counter made since the previous carried level. */
function changesTo(
  current: Levels,
  previous: Levels | undefined
): Partial<Record<Measured, number>> | undefined {
  if (!previous) return undefined

  const changes: Partial<Record<Measured, number>> = {}
  let any = false
  for (const counter of MEASURED) {
    const now = current[counter]
    const before = previous[counter]
    if (typeof now !== "number" || typeof before !== "number") continue
    changes[counter] = now - before
    any = true
  }
  return any ? changes : undefined
}

/** One row's measurement: the carried level, and the change when it was read. */
function measurementOf(
  levels: Levels,
  previous: Levels | undefined,
  observed: boolean
): StatsMeasurement {
  const values: StatsMeasurement = { levels: { ...levels } }
  const changes = observed ? changesTo(levels, previous) : undefined
  if (changes) values.changes = changes
  return values
}

/** Every dense day between the first and last reading, carried forward. */
function dailyRows(readings: Reading[]): StatsRow[] {
  const rows: StatsRow[] = []
  const first = readings[0]!.day
  const last = readings[readings.length - 1]!.day

  let index = 0
  let previous: Levels | undefined

  for (let day = first; day <= last; day += DAY) {
    while (index + 1 < readings.length && readings[index + 1]!.day <= day) {
      index += 1
    }
    const reading = readings[index]!
    const observed = reading.day === day

    rows.push({
      period: periodStart("day", civilOf(day)),
      values: measurementOf(reading.levels, previous, observed),
    })
    previous = reading.levels
  }

  return rows
}

/** Every dense ISO week the readings span, carried forward. */
function weeklyRows(readings: Reading[]): StatsRow[] {
  const rows: StatsRow[] = []
  const first = readings[0]!
  const last = weekStartOf(readings[readings.length - 1]!.day)

  // The week before the first reading, carrying that reading's level. A
  // ranking refuses a repository whose previous period has no row at all, so
  // without a predecessor the first week anyone actually read could never be
  // published — and its own change is left NULL, because the level this row
  // carries is the first reading itself, not a measurement of this week.
  rows.push({
    period: periodStart("week", civilOf(weekStartOf(first.day) - 7 * DAY)),
    values: { levels: { ...first.levels } },
  })

  let index = 0
  let previous: Levels | undefined = first.levels

  for (let start = weekStartOf(first.day); start <= last; start += 7 * DAY) {
    const end = start + 6 * DAY
    while (index + 1 < readings.length && readings[index + 1]!.day <= end) {
      index += 1
    }
    const reading = readings[index]
    if (!reading || reading.day > end) continue

    rows.push({
      period: periodStart("week", civilOf(start)),
      values: measurementOf(reading.levels, previous, reading.day >= start),
    })
    previous = reading.levels
  }

  return rows
}

/** Every dense calendar month the readings span, carried forward. */
function monthlyRows(readings: Reading[]): StatsRow[] {
  const rows: StatsRow[] = []
  const first = readings[0]!
  const last = monthStartOf(readings[readings.length - 1]!.day)

  // The month before the first reading, for the same reason the week before it
  // exists: the monthly ranking's predecessor is the previous month, and a
  // repository first read in September would otherwise have nothing to be
  // ranked against. The change is NULL here for the same reason. A day is
  // subtracted rather than a month's worth of them, because the 1st of a month
  // minus a month's worth of days lands a day early and files the row under
  // the month before that.
  rows.push({
    period: periodStart("month", civilOf(monthStartOf(first.day) - DAY)),
    values: { levels: { ...first.levels } },
  })

  let index = 0
  let previous: Levels | undefined = first.levels

  for (
    let start = monthStartOf(first.day);
    start <= last;
    start = monthStartOf(start + 32 * DAY)
  ) {
    const end = monthEndOf(start)
    while (index + 1 < readings.length && readings[index + 1]!.day <= end) {
      index += 1
    }
    const reading = readings[index]
    if (!reading || reading.day > end) continue

    rows.push({
      period: periodStart("month", civilOf(start)),
      values: measurementOf(reading.levels, previous, reading.day >= start),
    })
    previous = reading.levels
  }

  return rows
}

/** Row counts of the three stats tables, for the guard and the report. */
async function storedCounts(db: Db): Promise<Record<string, number>> {
  const tables = {
    repo_daily_stats: repoDailyStats,
    repo_weekly_stats: repoWeeklyStats,
    repo_monthly_stats: repoMonthlyStats,
  }
  const totals: Record<string, number> = {}
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ value: count() }).from(table)
    totals[name] = row?.value ?? 0
  }
  return totals
}

function describe(totals: Record<string, number>): string {
  return Object.entries(totals)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ")
}

async function main(): Promise<void> {
  const { db, pool } = await import("./client")
  const { upsertStatsRows } = await import("@/lib/github/service/stats")

  try {
    const before = await storedCounts(db)
    const stored = Object.values(before).reduce((sum, value) => sum + value, 0)
    const force = process.argv.includes("--force")
    if (stored > 0 && !force) {
      throw new Error(
        `the stats tables already hold ${stored} rows (${describe(before)}); ` +
          `run again with --force to replace them`
      )
    }
    if (stored > 0) {
      // Replaced, not merged into: a row left over from a previous run would
      // keep a delta this run decided not to write, because the writer only
      // updates the columns a measurement supplies.
      await db.delete(repoDailyStats)
      await db.delete(repoWeeklyStats)
      await db.delete(repoMonthlyStats)
    }

    const files = await db
      .select({
        repoId: snapshots.repoId,
        year: snapshots.year,
        months: snapshots.months,
      })
      .from(snapshots)

    // One row per repository per year, so a repository read in two years
    // arrives as two files. They are merged before anything is derived: read
    // separately, the second file would start its own series, and its first
    // period would have no predecessor to measure against — which is exactly
    // the period a ranking needs.
    const readingsByRepo = new Map<string, Reading[]>()
    for (const file of files) {
      const readings = readingsOf(file.year, file.months as RawMonth[] | null)
      if (readings.length === 0) continue
      const merged = readingsByRepo.get(file.repoId)
      if (merged) merged.push(...readings)
      else readingsByRepo.set(file.repoId, readings)
    }

    let repositories = 0
    let days = 0
    let weeks = 0
    let months = 0

    for (const [repoId, readings] of readingsByRepo) {
      readings.sort((a, b) => a.day - b.day)

      const daily = dailyRows(readings)
      const weekly = weeklyRows(readings)
      const monthly = monthlyRows(readings)

      await upsertStatsRows(db, repoId, daily, "day")
      await upsertStatsRows(db, repoId, weekly, "week")
      await upsertStatsRows(db, repoId, monthly, "month")

      repositories += 1
      days += daily.length
      weeks += weekly.length
      months += monthly.length
    }

    console.log(
      `stats derived from ${files.length} snapshot rows:\n` +
        `  repositories with readings: ${repositories}\n` +
        `  daily rows written:   ${days}\n` +
        `  weekly rows written:  ${weeks}\n` +
        `  monthly rows written: ${months}\n` +
        `  stored: ${describe(await storedCounts(db))}`
    )
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
