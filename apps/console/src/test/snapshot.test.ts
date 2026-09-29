import { describe, expect, it } from "vitest"
import type { SnapshotMonth } from "@/db/schema"
import {
  accumulateStarsByMonth,
  computeMonthlyTrend,
  computeWeeklyTrend,
  mergeMonth,
  sweepWeekRange,
} from "@/lib/github/service/snapshot"

function stamp(starredAt: string) {
  return { starredAt }
}

describe("accumulateStarsByMonth", () => {
  it("returns a running total, not a per-month count", () => {
    // GitHub reports only when someone starred, so a month holds the number
    // of people who had starred by its end. A per-month count would make
    // steady growth look flat.
    const result = accumulateStarsByMonth([
      stamp("2026-01-05T00:00:00Z"),
      stamp("2026-01-20T00:00:00Z"),
      stamp("2026-02-10T00:00:00Z"),
      stamp("2026-03-01T00:00:00Z"),
    ])

    expect(result).toEqual([
      { yearMonth: { year: 2026, month: 1 }, stars: 2 },
      { yearMonth: { year: 2026, month: 2 }, stars: 3 },
      { yearMonth: { year: 2026, month: 3 }, stars: 4 },
    ])
  })

  it("buckets by UTC month, not local time", () => {
    const result = accumulateStarsByMonth([
      stamp("2026-01-31T23:30:00Z"),
      stamp("2026-02-01T00:30:00Z"),
    ])

    expect(result).toEqual([
      { yearMonth: { year: 2026, month: 1 }, stars: 1 },
      { yearMonth: { year: 2026, month: 2 }, stars: 2 },
    ])
  })

  it("orders months chronologically across a year boundary", () => {
    const result = accumulateStarsByMonth([
      stamp("2026-02-01T00:00:00Z"),
      stamp("2025-11-01T00:00:00Z"),
      stamp("2026-01-01T00:00:00Z"),
    ])

    expect(result.map((r) => r.yearMonth)).toEqual([
      { year: 2025, month: 11 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ])
  })

  it("skips an unparseable timestamp instead of dropping the run", () => {
    const result = accumulateStarsByMonth([
      stamp("2026-01-05T00:00:00Z"),
      stamp("not a date"),
      stamp("2026-01-06T00:00:00Z"),
    ])

    expect(result).toEqual([
      { yearMonth: { year: 2026, month: 1 }, stars: 2 },
    ])
  })

  it("returns nothing for an empty sweep", () => {
    expect(accumulateStarsByMonth([])).toEqual([])
  })
})

describe("mergeMonth", () => {
  it("appends a month to an empty year", () => {
    expect(mergeMonth([], { year: 2026, month: 3 }, { stars: 10 })).toEqual([
      { year: 2026, month: 3, stars: 10 },
    ])
  })

  it("replaces the month rather than duplicating it", () => {
    const months = mergeMonth([], { year: 2026, month: 3 }, { stars: 10 })
    const updated = mergeMonth(months, { year: 2026, month: 3 }, { stars: 25 })

    expect(updated).toHaveLength(1)
    expect(updated[0]?.stars).toBe(25)
  })

  it("keeps months sorted regardless of insertion order", () => {
    let months: SnapshotMonth[] = []
    for (const month of [12, 1, 7, 3]) {
      months = mergeMonth(months, { year: 2026, month }, { stars: month })
    }

    expect(months.map((m) => m.month)).toEqual([1, 3, 7, 12])
  })

  it("does not let a stargazer run erase recorded downloads", () => {
    // Two collectors write different fields of the same month; neither may
    // blank the other's contribution.
    const withDownloads = mergeMonth(
      [],
      { year: 2026, month: 3 },
      { totalDownloads: 50_000 }
    )
    const withStars = mergeMonth(withDownloads, { year: 2026, month: 3 }, {
      stars: 120,
    })

    expect(withStars[0]).toEqual({
      year: 2026,
      month: 3,
      stars: 120,
      totalDownloads: 50_000,
    })
  })

  it("does not let a download run erase recorded stars", () => {
    const withStars = mergeMonth([], { year: 2026, month: 3 }, { stars: 120 })
    const withDownloads = mergeMonth(withStars, { year: 2026, month: 3 }, {
      totalDownloads: 50_000,
    })

    expect(withDownloads[0]?.stars).toBe(120)
    expect(withDownloads[0]?.totalDownloads).toBe(50_000)
  })

  it("defaults stars to zero for a new month", () => {
    expect(mergeMonth([], { year: 2026, month: 1 }, {})[0]).toEqual({
      year: 2026,
      month: 1,
      stars: 0,
    })
  })

  it("leaves other months untouched", () => {
    let months: SnapshotMonth[] = []
    months = mergeMonth(months, { year: 2026, month: 1 }, { stars: 10 })
    months = mergeMonth(months, { year: 2026, month: 2 }, { stars: 20 })
    months = mergeMonth(months, { year: 2026, month: 1 }, { stars: 15 })

    expect(months).toEqual([
      { year: 2026, month: 1, stars: 15 },
      { year: 2026, month: 2, stars: 20 },
    ])
  })
})

describe("computeMonthlyTrend", () => {
  const history: SnapshotMonth[] = [
    { year: 2026, month: 1, stars: 100 },
    { year: 2026, month: 2, stars: 180 },
    { year: 2026, month: 3, stars: 400 },
  ]

  it("reports the change from the preceding month", () => {
    expect(computeMonthlyTrend(history)).toEqual([
      { yearMonth: { year: 2026, month: 1 }, delta: undefined, total: 100 },
      { yearMonth: { year: 2026, month: 2 }, delta: 80, total: 180 },
      { yearMonth: { year: 2026, month: 3 }, delta: 220, total: 400 },
    ])
  })

  it("leaves the first month without a delta", () => {
    // Reporting the first month's total as growth would show a repository
    // appearing out of nowhere as a single month's gain.
    expect(computeMonthlyTrend(history)[0]?.delta).toBeUndefined()
  })

  it("reports no delta across a gap in the history", () => {
    const gapped: SnapshotMonth[] = [
      { year: 2026, month: 1, stars: 100 },
      { year: 2026, month: 3, stars: 400 },
    ]
    const trend = computeMonthlyTrend(gapped)

    expect(trend[1]?.delta).toBeUndefined()
    expect(trend[1]?.total).toBe(400)
  })

  it("carries the year across a December to January boundary", () => {
    const across: SnapshotMonth[] = [
      { year: 2025, month: 12, stars: 100 },
      { year: 2026, month: 1, stars: 130 },
    ]
    expect(computeMonthlyTrend(across)[1]?.delta).toBe(30)
  })

  it("can trend downloads instead of stars", () => {
    const downloads: SnapshotMonth[] = [
      { year: 2026, month: 1, stars: 0, totalDownloads: 1_000 },
      { year: 2026, month: 2, stars: 0, totalDownloads: 1_500 },
    ]
    expect(computeMonthlyTrend(downloads, "totalDownloads")[1]?.delta).toBe(500)
  })
})

describe("computeWeeklyTrend", () => {
  it("groups by ISO week and reports the change", () => {
    // Totals are per-week gains, so week 12 gained one stargazer against
    // week 11's three: a delta of -2.
    const trend = computeWeeklyTrend([
      stamp("2026-03-09T00:00:00Z"), // Monday, week 11
      stamp("2026-03-10T00:00:00Z"),
      stamp("2026-03-15T00:00:00Z"), // Sunday, still week 11
      stamp("2026-03-16T00:00:00Z"), // Monday, week 12
    ])

    expect(trend).toEqual([
      { yearWeek: { year: 2026, week: 11 }, delta: undefined, total: 3 },
      { yearWeek: { year: 2026, week: 12 }, delta: -2, total: 1 },
    ])
  })

  it("files a new-year stargazer under the ISO week that contains it", () => {
    // 1 January 2021 is a Friday, so it belongs to 2020 week 53. The
    // following Monday opens 2021 week 1.
    const trend = computeWeeklyTrend([
      stamp("2021-01-01T00:00:00Z"),
      stamp("2021-01-04T00:00:00Z"),
    ])

    expect(trend).toEqual([
      { yearWeek: { year: 2020, week: 53 }, delta: undefined, total: 1 },
      { yearWeek: { year: 2021, week: 1 }, delta: 0, total: 1 },
    ])
  })

  it("ignores unparseable timestamps", () => {
    expect(computeWeeklyTrend([stamp("nope")])).toEqual([])
  })
})

describe("sweepWeekRange", () => {
  it("reports the first and last week covered", () => {
    const range = sweepWeekRange([
      stamp("2026-03-20T00:00:00Z"),
      stamp("2026-03-02T00:00:00Z"),
      stamp("2026-03-10T00:00:00Z"),
    ])

    expect(range?.first).toEqual({ year: 2026, week: 10 })
    expect(range?.last).toEqual({ year: 2026, week: 12 })
  })

  it("returns nothing when there is no usable data", () => {
    expect(sweepWeekRange([])).toBeUndefined()
    expect(sweepWeekRange([stamp("nope")])).toBeUndefined()
  })
})
