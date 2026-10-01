import { describe, expect, test } from "vitest"
import {
  latestWeekGain,
  monthlyBars,
  periodTrends,
  type MonthlyStatsRow,
  type WeeklyArrivals,
} from "@/lib/github/service/stats"
import { lastNMonths, lastNWeeks } from "@/lib/github/snapshot-dates"
import { periodFromMonth } from "@/lib/github/snapshot-dates"

const zone = "Asia/Shanghai"

/**
 * A stored monthly row.
 *
 * The period is derived from the month rather than written as a literal instant,
 * because the whole point of the table is that a month is identified by the
 * instant Asia/Shanghai opened it. Hand-writing the instants here would let the
 * helper drift away from the table's own definition without a single test
 * noticing.
 */
function month(year: number, monthNumber: number, totalStars: number): MonthlyStatsRow {
  return {
    repoId: "repo",
    period: periodFromMonth({ year, month: monthNumber }, zone),
    totalStars,
    deltaStars: null,
    deltaNewStars: null,
    totalWatchers: null,
    deltaWatchers: null,
    totalForks: null,
    deltaForks: null,
    totalOpenIssues: null,
    deltaOpenIssues: null,
    totalPullRequests: null,
    deltaPullRequests: null,
    totalReleases: null,
    deltaReleases: null,
    totalContributors: null,
    deltaContributors: null,
    totalCommits: null,
    deltaCommits: null,
    totalDownloads: null,
    deltaDownloads: null,
    createdAt: new Date(0),
    updatedAt: null,
  }
}

/** The same row with a change, which is a column a separate writer supplies. */
function withDelta(row: MonthlyStatsRow, deltaStars: number | null): MonthlyStatsRow {
  return { ...row, deltaStars }
}

/**
 * A run of months that gained `step` each month.
 *
 * Deltas are written explicitly rather than derived here, because reading them
 * out of the stored column *is* what the tests are checking.
 */
function run(
  entries: [year: number, month: number, stars: number][],
  step: number | null
): MonthlyStatsRow[] {
  return entries.map(([year, monthNumber, stars], index) =>
    withDelta(month(year, monthNumber, stars), index === 0 ? null : step)
  )
}

const months = (...entries: [number, number, number][]) => run(entries, 10)

describe("lastNMonths", () => {
  test("ends on the month containing now, oldest first", () => {
    expect(lastNMonths(3, new Date(Date.UTC(2025, 5, 20)), zone)).toEqual([
      { year: 2025, month: 5 },
      { year: 2025, month: 6 },
      { year: 2025, month: 7 },
    ])
  })

  test("steps back across a year boundary", () => {
    expect(lastNMonths(3, new Date(Date.UTC(2025, 1, 15)), zone)).toEqual([
      { year: 2024, month: 12 },
      { year: 2025, month: 1 },
      { year: 2025, month: 2 },
    ])
  })

  test("handles a leap day without drifting", () => {
    // 29 February 2024 is the day this most often goes wrong, so it is checked
    // alongside an ordinary March.
    expect(lastNMonths(2, new Date(Date.UTC(2024, 2, 29)), zone)).toEqual([
      { year: 2024, month: 2 },
      { year: 2024, month: 3 },
    ])
    expect(lastNMonths(2, new Date(Date.UTC(2025, 2, 31)), zone)).toEqual([
      { year: 2025, month: 2 },
      { year: 2025, month: 3 },
    ])
  })

  test("does not repeat a month when stepping back from a 31-day month", () => {
    // Stepping back from 31 May aims at 31 April, which does not exist and
    // overflows forward into May, repeating the month and losing the oldest.
    const drawn = lastNMonths(12, new Date(Date.UTC(2025, 5, 20)), zone)
    expect(drawn).toHaveLength(12)
    expect(
      new Set(drawn.map((month) => month.year * 100 + month.month)).size
    ).toBe(12)
    expect(drawn[0]).toEqual({ year: 2024, month: 6 })
    expect(drawn[11]).toEqual({ year: 2025, month: 6 })
  })
})

describe("monthlyBars", () => {
  test("reads each month's stored change rather than subtracting levels", () => {
    const bars = monthlyBars(
      months([2025, 1, 10], [2025, 2, 25], [2025, 3, 30]),
      3,
      new Date(Date.UTC(2025, 3, 15)),
      zone
    )
    expect(bars).toEqual([
      { yearMonth: { year: 2025, month: 1 }, delta: undefined, total: 10 },
      { yearMonth: { year: 2025, month: 2 }, delta: 10, total: 25 },
      { yearMonth: { year: 2025, month: 3 }, delta: 10, total: 30 },
    ])
  })

  test("does not mistake a level for a change", () => {
    // The regression this guards: with only a level stored, a reader that
    // subtracted the previous one would report 15 stars of growth where the
    // stored change says 10, and the chart would contradict the table.
    const bars = monthlyBars(
      months([2025, 1, 10], [2025, 2, 25], [2025, 3, 30]),
      3,
      new Date(Date.UTC(2025, 3, 15)),
      zone
    )
    expect(bars.map((bar) => bar.delta)).toEqual([undefined, 10, 10])
  })

  test("leaves a month with no record unknown rather than zero", () => {
    const bars = monthlyBars(
      months([2025, 1, 10], [2025, 3, 30]),
      3,
      new Date(Date.UTC(2025, 3, 15)),
      zone
    )
    // February was never swept. Zero would read as a month of no growth.
    expect(bars[1]).toEqual({
      yearMonth: { year: 2025, month: 2 },
      delta: undefined,
      total: 0,
    })
  })

  test("keeps a full window of bars when the history is shorter", () => {
    const bars = monthlyBars(
      months([2025, 2, 25]),
      3,
      new Date(Date.UTC(2025, 3, 15)),
      zone
    )
    expect(bars).toHaveLength(3)
    expect(bars[0]!.delta).toBeUndefined()
  })

  test("returns all-undefined when the repository has no history", () => {
    const bars = monthlyBars([], 2, new Date(Date.UTC(2025, 3, 15)), zone)
    expect(bars.every((bar) => bar.delta === undefined)).toBe(true)
  })
})

describe("periodTrends", () => {
  test("measures the year against the same month a year back", () => {
    const trends = periodTrends(
      months(
        [2024, 3, 100],
        [2024, 4, 140],
        [2025, 3, 260],
        [2025, 4, 300]
      ),
      undefined,
      zone
    )
    expect(trends.month).toBe(10)
    // 300 now against 140 in the same month a year back: 160 over a year, read
    // as two levels rather than summed from the deltas in between, which would
    // have silently absorbed the months the history skipped.
    expect(trends.year).toBe(160)
    expect(trends.total).toBe(300)
  })

  test("leaves the year unknown without a month a year back", () => {
    const trends = periodTrends(months([2025, 3, 260], [2025, 4, 300]), undefined, zone)
    expect(trends.year).toBeUndefined()
    expect(trends.month).toBe(10)
  })

  test("reads the week from the newest weekly row on record", () => {
    const trends = periodTrends(months([2025, 3, 10], [2025, 4, 20]), [
      { yearWeek: { year: 2025, week: 10 }, stars: 4 },
      { yearWeek: { year: 2025, week: 12 }, stars: 6 },
      { yearWeek: { year: 2025, week: 11 }, stars: 9 },
    ], zone)
    expect(trends.week).toBe(6)
  })

  test("does not invent a week when the weekly table is empty", () => {
    const trends = periodTrends(months([2025, 3, 10], [2025, 4, 20]), [], zone)
    expect(trends.week).toBeUndefined()
    expect(trends.total).toBe(20)
  })

  test("returns every figure unknown with no history at all", () => {
    expect(periodTrends([], undefined, zone)).toEqual({
      week: undefined,
      month: undefined,
      year: undefined,
      total: undefined,
    })
  })
})

describe("latestWeekGain", () => {
  const week = (year: number, weekNumber: number, stars: number): WeeklyArrivals => ({
    yearWeek: { year, week: weekNumber },
    stars,
  })

  test("takes the highest ISO week, not the last row", () => {
    expect(latestWeekGain([
      week(2025, 12, 6),
      week(2025, 9, 99),
      week(2024, 52, 99),
    ])).toBe(6)
  })

  test("is undefined with no weekly rows", () => {
    expect(latestWeekGain([])).toBeUndefined()
  })
})

describe("lastNWeeks", () => {
  test("ends on the week containing now, oldest first", () => {
    const weeks = lastNWeeks(3, new Date(Date.UTC(2025, 0, 15)), zone)
    expect(weeks).toHaveLength(3)
    for (let index = 1; index < weeks.length; index++) {
      const previous = weeks[index - 1]!
      const current = weeks[index]!
      expect(
        current.year * 100 +
          current.week -
          (previous.year * 100 + previous.week)
      ).toBe(1)
    }
  })

  test("steps back across an ISO year boundary", () => {
    const weeks = lastNWeeks(3, new Date(Date.UTC(2025, 0, 3)), zone)
    expect(weeks[0]!.year).toBe(2024)
    expect(weeks[2]!.year).toBe(2025)
  })
})