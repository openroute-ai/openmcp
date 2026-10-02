/**
 * The repository statistics tables.
 *
 * Three tables, one shape: a level (`total_*`) and a change (`delta_*`) for nine
 * counters, at monthly, weekly and daily granularity. What changed from the
 * tables they replace is that the level and the change are stored side by side
 * rather than derived by each reader.
 *
 * That change is what removed most of this module's former complexity. A reader
 * that had to answer "how much did this grow" read a history, found the row for
 * the period before the one it cared about, and subtracted — and every reader
 * had to decide what a missing row meant. A repository nobody curated has no
 * contributor count, so a missing row had to mean "not measured" rather than
 * "zero", and each reader re-derived that distinction separately. Here the
 * answer is stored once, next to the number, as a NULL the reader passes
 * through.
 *
 * Periods are keyed by the instant they opened rather than by a year/month pair
 * or a date, because that instant is the only representation every calendar
 * agrees on once the timezone is fixed. See `periodStart` in
 * `lib/github/snapshot-dates.ts`.
 */

import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm"
import {
  repoDailyStats,
  repoMonthlyStats,
  repoStargazers,
  repoWeeklyStats,
} from "@/db/schema"
import {
  lastNMonths,
  monthOfPeriod,
  nextPeriod,
  periodOf,
  weekOfPeriod,
  type StatsCadence,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import type { StarHistoryEntry } from "@/lib/github/client"
import type { Db } from "@/lib/github/service/repo"
import { APP_TIMEZONE, civilOf } from "@/lib/time"

export type MonthlyStatsRow = typeof repoMonthlyStats.$inferSelect
export type WeeklyStatsRow = typeof repoWeeklyStats.$inferSelect
export type DailyStatsRow = typeof repoDailyStats.$inferSelect
export type StargazerRow = typeof repoStargazers.$inferSelect

/**
 * The counters a stats row can carry.
 *
 * Paired with the columns each is stored in rather than listed flat, so a writer
 * cannot record a level for one counter and a change for another without the
 * mismatch being visible where the writing happens. `newStars` has no level of
 * its own: the level *is* `stars`, and `deltaNewStars` counts the stargazers
 * that arrived during the period, which stops being the same number as
 * `deltaStars` the moment anyone unstars.
 */
export const COUNTERS = [
  { name: "stars", level: "totalStars", change: "deltaStars" },
  { name: "newStars", level: undefined, change: "deltaNewStars" },
  { name: "watchers", level: "totalWatchers", change: "deltaWatchers" },
  { name: "forks", level: "totalForks", change: "deltaForks" },
  { name: "openIssues", level: "totalOpenIssues", change: "deltaOpenIssues" },
  {
    name: "pullRequests",
    level: "totalPullRequests",
    change: "deltaPullRequests",
  },
  { name: "releases", level: "totalReleases", change: "deltaReleases" },
  {
    name: "contributors",
    level: "totalContributors",
    change: "deltaContributors",
  },
  { name: "commits", level: "totalCommits", change: "deltaCommits" },
  { name: "downloads", level: "totalDownloads", change: "deltaDownloads" },
] as const

export type CounterName = (typeof COUNTERS)[number]["name"]

/**
 * One number per counter, for a single column pair.
 *
 * Levels and changes are separate types because a measurement is a pair of them
 * and conflating them silently produces a wrong number rather than a type error:
 * one type for both would let a caller write this period's star count into both
 * `total_stars` and `delta_stars`, which is how a repository that gained 3,000
 * stars overnight ends up ranked as the month's biggest riser. `newStars` has
 * no level — the level *is* `stars` — so it is absent from {@link CounterLevels}.
 */
export type CounterLevels = Partial<
  Record<Exclude<CounterName, "newStars">, number>
>

/** What moved during a period, which may not have a level of its own. */
export type CounterChanges = Partial<Record<CounterName, number>>

/** A counter that has a level of its own, which is every counter but `newStars`. */
export type LevelCounter = Exclude<CounterName, "newStars">

/** The measurements a caller may supply for one period. */
export interface StatsMeasurement {
  levels?: CounterLevels
  changes?: CounterChanges
}

/** Both halves of a measurement, in the shape the writers build them. */
export type CounterValues = StatsMeasurement

/**
 * A union rather than a shared type: the three tables have identical columns,
 * but Drizzle carries the table's own name in its type, so a single table type
 * cannot describe all three without erasing it.
 */
type StatsTable =
  typeof repoDailyStats | typeof repoWeeklyStats | typeof repoMonthlyStats

/**
 * The part of a stats row a reader of the counters needs: its period, and one
 * nullable number per counter column.
 *
 * A structural stand-in for the three row types Drizzle returns. They are typed
 * as each table's own row, which no single type can accept as a union, and the
 * counters are all the same shape — so the columns are described by name instead.
 */
type StatsCounterRow = { period: Date } & {
  [column: string]: Date | number | string | null
}

const TABLES: Record<StatsCadence, StatsTable> = {
  day: repoDailyStats,
  week: repoWeeklyStats,
  month: repoMonthlyStats,
}

/** Statements per insert, kept well under Postgres' bind-parameter limit. */
const BATCH_SIZE = 200

/** Expands a measurement into the columns it is stored in, and nothing else. */
function toColumns(measurement: StatsMeasurement): Record<string, number> {
  const mapped: Record<string, number> = {}

  for (const counter of COUNTERS) {
    const level =
      counter.name === "newStars"
        ? undefined
        : measurement.levels?.[counter.name]
    if (level !== undefined && counter.level) mapped[counter.level] = level

    const change = measurement.changes?.[counter.name]
    if (change !== undefined && counter.change) mapped[counter.change] = change
  }

  return mapped
}

/** The columns a measurement writes, as a comparable signature. */
function columnSignature(measurement: StatsMeasurement): string {
  return Object.keys(toColumns(measurement)).sort().join(",")
}

/**
 * Writes the supplied columns of one period, leaving every other column alone.
 *
 * This is one function rather than several because two collectors write the same
 * rows. The star history knows `deltaNewStars` and little else; the daily
 * sampler knows the other counters and reads `stars` from the repository row.
 * Both run on the same schedule against the same table, and a writer that
 * replaced the whole row would erase the other's columns — which is what the
 * merge-based implementation this replaces had to defend against with an
 * advisory lock and a transaction.
 *
 * `onConflictDoUpdate` names the columns rather than assigning the row, so a
 * column this writer does not supply is not part of the update at all, and the
 * database resolves the conflict itself: there is no read-modify-write window
 * for a second writer to interleave with.
 */
export async function upsertStatsRow(
  db: Db,
  cadence: StatsCadence,
  repoId: string,
  period: Date,
  measurement: StatsMeasurement
): Promise<void> {
  const table = TABLES[cadence]
  const columns = toColumns(measurement)
  if (Object.keys(columns).length === 0) return

  await db
    .insert(table)
    .values({ repoId, period, updatedAt: new Date(), ...columns })
    .onConflictDoUpdate({
      target: [table.repoId, table.period],
      set: { updatedAt: new Date(), ...columns },
    })
}

/**
 * Writes many periods of one repository.
 *
 * A repository created in 2019 has thousands of daily rows, and one insert per
 * row turns a backfill into a round trip per day since it existed. Batching by
 * cadence keeps the statement bounded while making the number of round trips
 * proportional to the size of the history rather than to the age of the
 * repository.
 *
 * The conflict update takes each column from `excluded` — the row this statement
 * proposed for that period — rather than from a value assembled in JS. An
 * assembled value is the bug this avoids: it is one number for the whole batch,
 * so re-running a history sweep would write the last week's arrivals onto every
 * week already stored, and the chart would show a spike on every date at once.
 * `excluded` is the only source that stays per-row.
 *
 * Rows are grouped by which columns they carry before being batched, because
 * `excluded.<column>` is NULL for a row that did not propose that column. Two
 * rows that carry different columns cannot therefore share a statement, and
 * splitting them by signature is what keeps the batches large (a history sweep
 * carries the same two columns on every row) without mixing them.
 */
export async function upsertStatsRows(
  db: Db,
  repoId: string,
  rows: { period: Date; values: StatsMeasurement }[],
  cadence: StatsCadence
): Promise<void> {
  if (rows.length === 0) return
  const table = TABLES[cadence]
  // `toColumns` keys its result by the *property* names `COUNTERS` uses
  // (`totalStars`), while the statement needs the database's column name. Handing
  // the property name to `sql.raw` produced `excluded."totalStars"`, which
  // Postgres reads as one identifier and answers `column does not exist`, so the
  // name is resolved through the table's own column map instead. The quotes are
  // the only thing written by hand: a column object renders as
  // `"repo_daily_stats"."total_stars"`, which cannot be qualified by `excluded`.
  const columnsByProperty = getTableColumns(table)

  for (const batch of chunk(rows, BATCH_SIZE)) {
    for (const group of groupBySignature(batch)) {
      const columns = toColumns(group[0]!.values)

      await db
        .insert(table)
        .values(
          group.map((row) => ({
            repoId,
            period: row.period,
            updatedAt: new Date(),
            ...toColumns(row.values),
          }))
        )
        .onConflictDoUpdate({
          target: [table.repoId, table.period],
          set: {
            updatedAt: new Date(),
            // The names come from the table's own column map, never from a
            // caller, so the statement never spells a column name by hand.
            ...Object.fromEntries(
              Object.keys(columns).map((property) => [
                property,
                sql.raw(
                  `excluded."${columnsByProperty[property as keyof typeof columnsByProperty]!.name}"`
                ),
              ])
            ),
          },
        })
    }
  }
}

/** Splits rows into batches that carry the same set of columns. */
function groupBySignature<T extends { values: StatsMeasurement }>(
  rows: T[]
): T[][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = columnSignature(row.values)
    if (key === "") continue
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()]
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/** One period of one repository's history, in the shape the readers consume. */
export interface PeriodStats {
  period: Date
  /** The level at the end of the period, or null when it was never measured. */
  total: number | null
  /** The change during the period, or null when there is no comparable prior. */
  delta: number | null
  /** Stargazers who arrived during the period, before any were removed. */
  newStars: number | null
}

/**
 * Converts stored rows into the reader's shape, oldest first.
 *
 * `counter` picks which level is the headline number; a caller asking for the
 * contributor trend reads `totalContributors`. The NULLs survive the conversion,
 * which is the point: an uncurated repository has no contributor count, and the
 * caller needs to tell that apart from zero.
 */
export function toPeriodStats(
  rows: Record<string, unknown>[],
  counter: CounterName = "stars"
): PeriodStats[] {
  const level = COUNTERS.find((entry) => entry.name === counter)?.level
  const change = COUNTERS.find((entry) => entry.name === counter)?.change

  return rows
    .map((row) => ({
      period: row.period as Date,
      total: level ? (row[level] as number | null) : null,
      delta: change ? ((row[change] as number | null) ?? null) : null,
      newStars: (row.deltaNewStars as number | null) ?? null,
    }))
    .sort((a, b) => a.period.getTime() - b.period.getTime())
}

/** Every monthly period a repository has rows for, oldest first. */
export async function listMonthlyStats(
  db: Db,
  repoId: string,
  limit?: number
): Promise<MonthlyStatsRow[]> {
  const query = db
    .select()
    .from(repoMonthlyStats)
    .where(eq(repoMonthlyStats.repoId, repoId))
    .orderBy(asc(repoMonthlyStats.period))

  return typeof limit === "number" ? query.limit(limit) : query
}

/**
 * The most recent `count` weekly periods, oldest first.
 *
 * Newest-first is what the database is asked for and oldest-first is what the
 * caller gets, because a `LIMIT` keeps the *first* rows it is handed: ordering
 * ascending and limiting returns the repository's oldest history, which is how a
 * ten-year-old repository ends up charting its first weeks forever.
 */
export async function listRecentWeeklyStats(
  db: Db,
  repoId: string,
  count: number
): Promise<WeeklyStatsRow[]> {
  const rows = await db
    .select()
    .from(repoWeeklyStats)
    .where(eq(repoWeeklyStats.repoId, repoId))
    .orderBy(desc(repoWeeklyStats.period))
    .limit(count)

  return rows.reverse()
}

/** The most recent `count` daily periods, oldest first, on the same ordering. */
export async function listRecentDailyStats(
  db: Db,
  repoId: string,
  count: number
): Promise<DailyStatsRow[]> {
  const rows = await db
    .select()
    .from(repoDailyStats)
    .where(eq(repoDailyStats.repoId, repoId))
    .orderBy(desc(repoDailyStats.period))
    .limit(count)

  return rows.reverse()
}

/** The instants of every monthly period that holds data anywhere, newest first. */
export async function listMonthlyPeriodStarts(
  db: Db,
  limit = 120
): Promise<Date[]> {
  const rows = await db
    .selectDistinct({ period: repoMonthlyStats.period })
    .from(repoMonthlyStats)
    .orderBy(asc(repoMonthlyStats.period))

  // The distinct periods are sorted ascending by the query, so reversing gives
  // "most recent first" without a second ordering to keep consistent.
  return rows
    .map((row) => row.period)
    .reverse()
    .slice(0, limit)
}

/** The instants of every weekly period that holds data anywhere, newest first. */
export async function listWeeklyPeriodStarts(
  db: Db,
  limit = 120
): Promise<Date[]> {
  const rows = await db
    .selectDistinct({ period: repoWeeklyStats.period })
    .from(repoWeeklyStats)
    .orderBy(asc(repoWeeklyStats.period))

  return rows
    .map((row) => row.period)
    .reverse()
    .slice(0, limit)
}

/**
 * Calendar years holding any monthly history, ascending.
 *
 * The year is taken from the stored instant in the application timezone rather
 * than from an indexed column: there is no year column, because the period
 * instant is what the row is keyed by. Reading it in UTC would call January's
 * month — which opens on the 31st of December at 16:00 UTC — a year earlier.
 */
export async function listMonthlyHistoryYears(db: Db): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(sql`
    select distinct extract(year from ${repoMonthlyStats.period} at time zone ${APP_TIMEZONE})::int as year
    from ${repoMonthlyStats}
    order by year asc
  `)

  return rows.rows.map((row) => row.year)
}

/** Repository ids that already have a daily history backfilled. */
export async function listReposWithDailyStats(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ repoId: repoDailyStats.repoId })
    .from(repoDailyStats)
  return rows.map((row) => row.repoId)
}

/**
 * Records the counters measured on a repository's stored row, for every period
 * currently open.
 *
 * All three granularities come from one read of the row because they are three
 * views of the same measurement; taking them separately would let the day and
 * the week disagree about what the repository looked like when the numbers were
 * fetched.
 *
 * The change is computed against the previous period's *stored* level rather
 * than against the previous value seen in memory. A sampler that runs twice in a
 * day therefore records 0 the second time rather than doubling the apparent
 * growth, and a counter with no stored level for the previous period records
 * NULL rather than the difference from zero: a repository appearing for the
 * first time did not gain its entire star count overnight, and reporting that
 * would put every new repository at the top of the trending list.
 */
export async function recordCurrentPeriods(
  db: Db,
  repo: {
    id: string
    /**
     * The repository's stored counters. Every one is optional, because absent and
     * null mean the same thing here — not measured — and a caller that read a
     * partial row should not have to invent zeros to satisfy the signature.
     */
    stars?: number | null
    forks?: number | null
    watchersCount?: number | null
    openIssuesCount?: number | null
    pullRequestsCount?: number | null
    releasesCount?: number | null
    contributorCount?: number | null
    commitCount?: number | null
    /**
     * npm downloads, which live on the package rather than the repository. Not
     * every project has a package, so it is optional rather than nullable on
     * purpose: absent means "not measured", which is different from zero.
     */
    downloads?: number | null
  },
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): Promise<void> {
  const levels: CounterLevels = {}
  const map: [LevelCounter, number | null | undefined][] = [
    ["stars", repo.stars],
    ["watchers", repo.watchersCount],
    ["forks", repo.forks],
    ["openIssues", repo.openIssuesCount],
    ["pullRequests", repo.pullRequestsCount],
    ["releases", repo.releasesCount],
    ["contributors", repo.contributorCount],
    ["commits", repo.commitCount],
    ["downloads", repo.downloads],
  ]
  for (const [name, value] of map) {
    if (typeof value === "number") levels[name] = value
  }

  // One statement per period, carrying the level and the change as separate
  // halves, because the change needs the previous period's level and that is a
  // different query per cadence. A counter with no stored prior is left out of
  // `changes` rather than written as a difference from zero: see above.
  for (const cadence of ["day", "week", "month"] as const) {
    const period = periodOf(now, cadence, timeZone)
    const previous = await previousLevels(db, cadence, repo.id, period)

    const changes: CounterChanges = {}
    for (const [name, value] of map) {
      const before = previous?.[name]
      if (before === undefined) continue
      changes[name] = value! - before
    }

    await upsertStatsRow(db, cadence, repo.id, period, { levels, changes })
  }
}

/** The level each counter closed the previous period at, when one is stored. */
async function previousLevels(
  db: Db,
  cadence: StatsCadence,
  repoId: string,
  period: Date
): Promise<CounterLevels | undefined> {
  const table = TABLES[cadence]
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.repoId, repoId), sql`${table.period} < ${period}`))
    .orderBy(sql`${table.period} desc`)
    .limit(1)

  if (!row) return undefined

  const levels: CounterLevels = {}
  for (const counter of COUNTERS) {
    // `counter.name` narrows to the counters that own a level once `level` is
    // truthy, which is exactly the set {@link CounterLevels} is keyed by.
    if (!counter.level) continue
    const value = (row as Record<string, unknown>)[counter.level]
    if (typeof value === "number") levels[counter.name] = value
  }
  return levels
}

/**
 * Records a star history at all three granularities.
 *
 * The endpoint reports one bucket per week with the cumulative count at the
 * bucket's end and a seven-day breakdown inside it, which is enough to write
 * both halves of every closed period:
 *
 * - **arrivals** (`delta_new_stars`) at day, week and month granularity, summed
 *   from the `days` arrays;
 * - **levels** (`total_stars`) for the week each bucket closed, which is
 *   GitHub's own `total` rather than a sum of arrivals — the two differ whenever
 *   somebody unstarred, and the level has to be the one GitHub reports;
 * - **net changes** (`delta_stars`) as the difference between consecutive
 *   levels, which is negative when stars were removed.
 *
 * Two things are deliberately not written:
 *
 * - A month gets the level of the *last* week inside it, because a bucket that
 *   ends on the last day of a month is the closest thing to a month-end reading
 *   the endpoint offers; a month with no bucket in it gets no level rather than a
 *   carried-forward one.
 * - Periods that are still open. The daily sampler owns those, and it reads the
 *   repository's own star count, which is more recent than the last complete
 *   bucket. Writing a level here would overwrite the authoritative number with
 *   one measured hours or weeks ago — silently, because the write is keyed on the
 *   period rather than on the moment. Arrivals are still written for an open
 *   period, since they are a different column and a day that has already happened
 *   is a fact.
 *
 * The first bucket has no predecessor, so its `delta_stars` is left NULL rather
 * than reported as its own level: the repository did not gain its entire star
 * count in the week its history begins.
 *
 * Returns the number of days written, so a caller can tell a repository whose
 * history is empty from one whose stars all predate this table.
 */
export async function recordStarHistory(
  db: Db,
  repoId: string,
  entries: StarHistoryEntry[],
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): Promise<number> {
  if (entries.length === 0) return 0

  const weeks = [...entries].sort((a, b) => a.week - b.week)
  const days = dailyArrivals(weeks)
  if (days.size === 0) return 0

  for (const cadence of ["day", "week", "month"] as const) {
    const rows: { period: Date; values: StatsMeasurement }[] = []

    // Arrivals first, so a period with arrivals but no level — an open week, or a
    // month the buckets skip over — still gets its row.
    const arrivals = new Map<number, number>()
    for (const [day, count] of days) {
      const key = periodOf(day, cadence, timeZone).getTime()
      arrivals.set(key, (arrivals.get(key) ?? 0) + count)
    }

    // The level each bucket closed its week at, and the day that week ended.
    const levels = new Map<number, { stars: number; endedAt: number }>()
    for (const entry of weeks) {
      const sunday = new Date((entry.week + DAYS_PER_WEEK - 1) * 86_400_000)
      const key = periodOf(sunday, cadence, timeZone).getTime()
      const existing = levels.get(key)
      if (!existing || existing.endedAt < sunday.getTime()) {
        levels.set(key, { stars: entry.total, endedAt: sunday.getTime() })
      }
    }

    // Daily rows are arrivals only. A closed day's star total is what the daily
    // sampler reads off the repository, so history must not write one here and
    // claim it measured a level it never saw.
    const ownsLevel = cadence !== "day"

    for (const [key, count] of arrivals) {
      const period = new Date(key)
      const values: StatsMeasurement = { changes: { newStars: count } }
      const level = levels.get(key)

      if (ownsLevel && level && isClosed(period, cadence, now, timeZone)) {
        values.levels = { stars: level.stars }
        const previous = [...levels.entries()]
          .filter(([periodKey]) => periodKey < key)
          .sort(([a], [b]) => a - b)
          .at(-1)
        const before = previous?.[1].stars
        if (before !== undefined) values.changes!.stars = level.stars - before
      }

      rows.push({ period, values })
    }

    await upsertStatsRows(db, repoId, rows, cadence)
  }

  return days.size
}

/** Days in a week, which is also how far one weekly bucket spans. */
const DAYS_PER_WEEK = 7

/**
 * Turns weekly buckets into per-day arrivals, oldest first.
 *
 * GitHub's `week` is the Sunday that opens the bucket and its `days` array runs
 * Monday to Sunday, so a day is dated from `week` plus a day plus its index. The
 * day *after* the bucket's Sunday belongs to the next bucket, and buckets that
 * report seven days therefore cover the Monday before the Sunday they are named
 * after.
 */
function dailyArrivals(entries: StarHistoryEntry[]): Map<Date, number> {
  const arrivals = new Map<Date, number>()

  for (const entry of entries) {
    const monday = new Date((entry.week + 1) * 86_400_000)
    for (
      let index = 0;
      index < entry.days.length && index < DAYS_PER_WEEK;
      index += 1
    ) {
      const day = new Date(monday.getTime() + index * 86_400_000)
      arrivals.set(day, (arrivals.get(day) ?? 0) + (entry.days[index] ?? 0))
    }
  }

  // Every day between the first and last one GitHub reported. A week it left
  // out is a week nothing happened, and a zero row says so; a missing row would
  // leave a chart drawing a straight line straight through the gap.
  const days = [...arrivals.keys()].sort((a, b) => a.getTime() - b.getTime())
  const firstDay = days[0]!.getTime()
  const lastDay = days.at(-1)!.getTime()
  for (let time = firstDay; time <= lastDay; time += DAY) {
    if (!arrivals.has(new Date(time))) arrivals.set(new Date(time), 0)
  }

  return new Map(
    [...arrivals.entries()].sort(([a], [b]) => a.getTime() - b.getTime())
  )
}

/** Seconds in a day, which is also the step a densified range walks. */
const DAY = 86_400_000

/**
 * Whether a period has ended, which is what decides whether a level may be
 * written into it.
 *
 * The next period opening is the same statement said the other way round, and
 * asking it that way avoids re-deriving how long a month is.
 */
function isClosed(
  period: Date,
  cadence: StatsCadence,
  now: Date,
  timeZone: string
): boolean {
  const next = nextPeriod(period, cadence, timeZone)
  return next.getTime() <= now.getTime()
}

/**
 * Stores individual stargazers.
 *
 * Appended rather than replaced, and keyed on `(repo, login)`, because this
 * endpoint answers for repository administrators and collaborators only: a
 * repository that answers today may answer 403 tomorrow, and a sweep that
 * deleted what it had would destroy the only record of who starred and when. A
 * stargazer already stored is therefore left as it is, except that a later read
 * of the same person corrects their timestamp.
 */
export async function recordStargazers(
  db: Db,
  repoId: string,
  stargazers: { login: string; starredAt: Date }[]
): Promise<number> {
  if (stargazers.length === 0) return 0

  await db
    .insert(repoStargazers)
    .values(
      stargazers.map((entry) => ({
        repoId,
        login: entry.login,
        starredAt: entry.starredAt,
      }))
    )
    .onConflictDoUpdate({
      target: [repoStargazers.repoId, repoStargazers.login],
      set: {
        starredAt: sql`greatest(${repoStargazers.starredAt}, excluded.starred_at)`,
      },
    })

  return stargazers.length
}

/** The newest stargazer already stored, which an incremental sweep resumes from. */
export async function latestStargazerAt(
  db: Db,
  repoId: string
): Promise<Date | undefined> {
  const [row] = await db
    .select({ starredAt: repoStargazers.starredAt })
    .from(repoStargazers)
    .where(eq(repoStargazers.repoId, repoId))
    .orderBy(sql`${repoStargazers.starredAt} desc`)
    .limit(1)
  return row?.starredAt
}

/** How many stargazers are stored for a repository. */
export async function countStargazers(db: Db, repoId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(repoStargazers)
    .where(eq(repoStargazers.repoId, repoId))
  return row?.count ?? 0
}

/** Deletes every stats row for a repository, for a rebuild. */
export async function clearStats(db: Db, repoId: string): Promise<void> {
  await db.delete(repoDailyStats).where(eq(repoDailyStats.repoId, repoId))
  await db.delete(repoWeeklyStats).where(eq(repoWeeklyStats.repoId, repoId))
  await db.delete(repoMonthlyStats).where(eq(repoMonthlyStats.repoId, repoId))
}

/** One counter as a period recorded it: the level and the change together. */
export interface CounterReading {
  /** The level the period closed at, or null when it was not measured. */
  total: number | null
  /** Movement during the period, or null when it was not measured. */
  delta: number | null
}

/**
 * The counters one period carries, keyed by counter name.
 *
 * Partial because a row stores only what its writer measured: the star history
 * writes stars, the daily sampler writes the rest, and a counter nobody measured
 * is absent rather than zero — the same distinction a NULL column makes, kept on
 * this side of the reader so no tooltip has to rediscover it.
 */
export type CounterReadings = Partial<Record<CounterName, CounterReading>>

/** One day's star growth, as a calendar day rather than an instant. */
export interface DailyArrivals {
  day: string
  /**
   * What the day gained, or undefined when no writer measured it.
   *
   * Arrivals when the history sweep has been here, the net movement the sampler
   * recorded otherwise — see {@link starGrowthOf}.
   */
  stars: number | undefined
  /** Everything else the day's row recorded, for the reader's tooltip. */
  counters?: CounterReadings
}

/** One week's star growth, named by ISO year and week. */
export interface WeeklyArrivals {
  yearWeek: YearWeek
  /** What the week gained, or undefined when no writer measured it. */
  stars: number | undefined
  /** Everything else the week's row recorded, for the reader's tooltip. */
  counters?: CounterReadings
}

/**
 * What one period's bar shows: how many stars it gained.
 *
 * Two columns record that, and a period can carry either one:
 *
 * - `deltaNewStars` — stargazers who arrived, summed from per-stargazer
 *   timestamps by the history sweep. It is the better number, because a week
 *   somebody unstarred still answers "how many people arrived", but it exists
 *   only for a repository the sweep has run on.
 * - `deltaStars` — the movement between the level this period closed at and the
 *   level the period before it closed at, written by the sampler for every
 *   repository it reads.
 *
 * Arrivals win when both are present, and a period neither writer measured stays
 * `undefined` rather than becoming a zero. A zero here is a claim — "nobody
 * starred this project that day" — and a reader that invents one charts a
 * repository nobody ever swept as a project that stopped earning stars, with no
 * gap and no way to tell it apart from a real decline.
 */
function starGrowthOf(row: StatsCounterRow | undefined): number | undefined {
  if (!row) return undefined
  return (
    (row.deltaNewStars as number | null | undefined) ??
    (row.deltaStars as number | null | undefined) ??
    undefined
  )
}

/** One bar of a monthly chart. */
export interface MonthlyBar {
  yearMonth: YearMonth
  /**
   * Movement over the month, or undefined when the month has no stored history.
   * Undefined is not zero: a month with no prior row has an unknown change, and
   * drawing it as a flat bar reads as a project that stopped growing.
   */
  delta: number | undefined
  /** The level the month closed at, or 0 when the month was never measured. */
  total: number
}

/**
 * Month-over-month movement for the last `count` complete months.
 *
 * Months with no stored row stay in as `undefined` rather than being dropped, so
 * the chart keeps a gap where the history has a gap. A dropped month is
 * indistinguishable from a month of zero growth, and a repository never swept
 * would chart as a project that stopped earning stars.
 *
 * Ends on the previous month for the same reason the underlying rows do: an open
 * month is short for reasons of its own.
 */
export function monthlyBars(
  rows: MonthlyStatsRow[],
  count: number,
  now: Date,
  timeZone: string = APP_TIMEZONE
): MonthlyBar[] {
  const byMonth = new Map(
    rows.map((row) => {
      const { year, month } = monthOfPeriod(row.period, timeZone)
      return [`${year}-${month}`, row] as const
    })
  )

  return lastNMonths(count, now, timeZone).map((yearMonth) => {
    const row = byMonth.get(`${yearMonth.year}-${yearMonth.month}`)
    return {
      yearMonth,
      delta: row?.deltaStars ?? undefined,
      total: row?.totalStars ?? 0,
    }
  })
}

/** The headline growth figures, over the windows the stored history supports. */
export interface PeriodTrends {
  /** Stargazers who arrived in the most recent ISO week on record. */
  week: number | undefined
  /** Movement over the most recent month with a comparable prior. */
  month: number | undefined
  /** Level twelve months after the most recent recorded month. */
  year: number | undefined
  /** The most recent recorded month's closing level. */
  total: number | undefined
}

/**
 * The headline growth figures, over the windows the stored history supports.
 *
 * Every figure comes from a recorded period rather than from a difference
 * against the calendar today. The history is written by a sweep that can stop
 * whenever it likes, so its last month may be any month in the past; subtracting
 * it from today would report a project as having gained every star it has gained
 * since it was last swept, inside one recent window.
 *
 * A window with no comparable history is `undefined` rather than 0, so the page
 * can say it is unknown instead of reporting that nothing happened.
 */
export function periodTrends(
  monthly: MonthlyStatsRow[],
  weekly?: WeeklyArrivals[],
  timeZone: string = APP_TIMEZONE
): PeriodTrends {
  const ordered = [...monthly].sort(
    (a, b) => a.period.getTime() - b.period.getTime()
  )
  const last = ordered[ordered.length - 1]
  if (!last) {
    return {
      week: latestWeekGain(weekly),
      month: undefined,
      year: undefined,
      total: undefined,
    }
  }

  const { year, month } = monthOfPeriod(last.period, timeZone)
  const yearAgo = ordered.find((row) => {
    const at = monthOfPeriod(row.period, timeZone)
    return at.year === year - 1 && at.month === month
  })

  return {
    week: latestWeekGain(weekly),
    month: last.deltaStars ?? undefined,
    // A level difference rather than a sum of deltas: the deltas are each
    // relative to the month before, so a gap in the history would silently
    // exclude the movement made during it.
    year:
      yearAgo?.totalStars === null || yearAgo?.totalStars === undefined
        ? undefined
        : (last.totalStars ?? 0) - yearAgo.totalStars,
    total: last.totalStars ?? undefined,
  }
}

/**
 * Arrivals in the most recent recorded week.
 *
 * Positional rather than by week number, so the caller owes it an ascending
 * window: `listWeeklyArrivals` returns oldest first, and an ISO year wraps at
 * 52, so comparing week numbers alone would answer a different question than
 * "the most recent week".
 */
export function latestWeekGain(
  weekly: WeeklyArrivals[] | undefined
): number | undefined {
  const latest = weekly?.[weekly.length - 1]
  return latest?.stars
}

/**
 * New stars per calendar day, oldest first, over a trailing window.
 *
 * The bars read through {@link starGrowthOf}: the stargazer arrivals the history
 * sweep writes, falling back to the net movement the sampler recorded. Reading
 * `deltaNewStars` alone left the window empty for every repository the sweep had
 * not reached — the column is NULL there, and NULL was being turned into zero,
 * which is a flat run of bars saying nothing rather than a gap saying "not
 * measured". Arrivals remain the preferred number where both exist, since a day
 * someone unstarred still reads as the number of people who arrived, which is
 * what the public chart claims when it labels a bar "new".
 *
 * The window ends at the newest stored day rather than at today. A repository
 * nobody has starred in a month then charts its own last month of activity
 * instead of a run reaching all the way to the present, and the caller dates the
 * axis from the data rather than from the clock.
 *
 * Days inside the window with no row, and rows no writer measured, are drawn as
 * gaps rather than as zeros. Both are "we did not look", and a quiet day is only
 * a zero once something has actually recorded it.
 */
export async function listDailyArrivals(
  db: Db,
  repoId: string,
  days = DAILY_ARRIVALS_WINDOW_DAYS,
  timeZone: string = APP_TIMEZONE
): Promise<DailyArrivals[]> {
  // Newest first, then reversed, because the window is the *last* `days` rows:
  // ordering ascending and limiting would return the repository's first `days`
  // days and call them a trailing window.
  const rows = await db
    .select()
    .from(repoDailyStats)
    .where(eq(repoDailyStats.repoId, repoId))
    .orderBy(desc(repoDailyStats.period))
    .limit(days)

  rows.reverse()

  if (rows.length === 0) return []

  const counts = new Map(
    rows.map((row) => [dayKeyOf(row.period, timeZone), row])
  )
  const last = dayKeyOf(rows[rows.length - 1]!.period, timeZone)
  const first = addDays(last, -(rows.length - 1))

  const dense: DailyArrivals[] = []
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const row = counts.get(day)
    dense.push({
      day,
      stars: starGrowthOf(row),
      counters: row ? readingsOf(row) : undefined,
    })
  }
  return dense
}

/**
 * Star growth per ISO week, oldest first, over a trailing window.
 *
 * Read through {@link starGrowthOf}, for the same reason as the daily reader:
 * a repository the history sweep never reached still has the net movement the
 * sampler recorded, and reading only the arrivals column threw it away.
 *
 * The window is taken from the end of the stored history rather than filtered on
 * a date, because a ten-year-old repository has five hundred weeks of rows and
 * the chart needs a dozen.
 */
export async function listWeeklyArrivals(
  db: Db,
  repoId: string,
  weeks = WEEKLY_ARRIVALS_WINDOW,
  timeZone: string = APP_TIMEZONE
): Promise<WeeklyArrivals[]> {
  const rows = await db
    .select()
    .from(repoWeeklyStats)
    .where(eq(repoWeeklyStats.repoId, repoId))
    .orderBy(desc(repoWeeklyStats.period))
    .limit(weeks)

  rows.reverse()

  return rows.map((row) => ({
    yearWeek: weekOfPeriod(row.period, timeZone),
    stars: starGrowthOf(row),
    counters: readingsOf(row),
  }))
}

/**
 * A stats row as its counters, dropping the ones it does not carry.
 *
 * Driven by `COUNTERS` rather than by the row's own keys, so a counter added to
 * that list shows up in every reader at once instead of needing a second edit in
 * each one. A counter with no level but a change (`newStars`) is kept as a
 * delta-only reading, and a counter with neither is absent from the result rather
 * than present with two nulls: "not measured" and "measured as nothing" have to
 * stay distinguishable all the way to the tooltip.
 */
function readingsOf(row: StatsCounterRow): CounterReadings {
  const readings: CounterReadings = {}

  for (const counter of COUNTERS) {
    const total = counter.level ? (row[counter.level] as number | null) : null
    const delta = row[counter.change] as number | null
    if (total === null && delta === null) continue
    readings[counter.name] = { total, delta }
  }

  return readings
}

/** The newest daily row's calendar day, or undefined when there is no history. */
export async function latestDay(
  db: Db,
  repoId: string,
  timeZone: string = APP_TIMEZONE
): Promise<string | undefined> {
  const [row] = await db
    .select({ period: repoDailyStats.period })
    .from(repoDailyStats)
    .where(eq(repoDailyStats.repoId, repoId))
    .orderBy(sql`${repoDailyStats.period} desc`)
    .limit(1)
  return row ? dayKeyOf(row.period, timeZone) : undefined
}

/** How many days of daily history a public chart shows. */
export const DAILY_ARRIVALS_WINDOW_DAYS = 90

/** How many weeks of weekly history a chart shows. */
export const WEEKLY_ARRIVALS_WINDOW = 12

/** A calendar day in a timezone, as `YYYY-MM-DD`. */
function dayKeyOf(instant: Date, timeZone: string): string {
  const civil = civilOf(instant, timeZone)
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0")
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  const shifted = new Date(Date.UTC(year, month - 1, date + days))
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(
    shifted.getUTCMonth() + 1,
    2
  )}-${pad(shifted.getUTCDate(), 2)}`
}
