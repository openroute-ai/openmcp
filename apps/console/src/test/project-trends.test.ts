import { describe, expect, test } from "vitest"
import {
  lastNMonths,
  lastNWeeks,
  latestWeekGain,
  monthlyBars,
  periodTrends,
} from "@/lib/github/service/snapshot"

const months = (...entries: [number, number, number][]) =>
  entries.map(([year, month, stars]) => ({ year, month, stars }))

describe("lastNMonths", () => {
  test("ends on the month before now, oldest first", () => {
    expect(lastNMonths(3, new Date(Date.UTC(2025, 5, 20)))).toEqual([
      { year: 2025, month: 3 },
      { year: 2025, month: 4 },
      { year: 2025, month: 5 },
    ])
  })

  test("steps back across a year boundary", () => {
    expect(lastNMonths(3, new Date(Date.UTC(2025, 1, 15)))).toEqual([
      { year: 2024, month: 11 },
      { year: 2024, month: 12 },
      { year: 2025, month: 1 },
    ])
  })

  test("excludes the current month so a partial month is never charted", () => {
    const drawn = lastNMonths(1, new Date(Date.UTC(2025, 5, 1)))
    expect(drawn).toEqual([{ year: 2025, month: 5 }])
  })

  test("handles a leap day without drifting", () => {
    // 29 February 2024 is the day this most often goes wrong, so it is
    // checked alongside an ordinary March.
    expect(lastNMonths(2, new Date(Date.UTC(2024, 2, 29)))).toEqual([
      { year: 2024, month: 1 },
      { year: 2024, month: 2 },
    ])
    expect(lastNMonths(2, new Date(Date.UTC(2025, 2, 31)))).toEqual([
      { year: 2025, month: 1 },
      { year: 2025, month: 2 },
    ])
  })

  test("does not repeat a month when stepping back from a 31-day month", () => {
    // Stepping back from May 31 aims at April 31, which does not exist and
    // overflows forward into May, repeating the month and losing the oldest.
    const drawn = lastNMonths(12, new Date(Date.UTC(2025, 5, 20)))
    expect(drawn).toHaveLength(12)
    expect(
      new Set(drawn.map((month) => month.year * 100 + month.month)).size
    ).toBe(12)
    expect(drawn[0]).toEqual({ year: 2024, month: 6 })
    expect(drawn[11]).toEqual({ year: 2025, month: 5 })
  })
})

describe("monthlyBars", () => {
  test("reports each month's growth against the month before it", () => {
    const bars = monthlyBars(
      months([2025, 1, 10], [2025, 2, 25], [2025, 3, 30]),
      3,
      new Date(Date.UTC(2025, 3, 15))
    )
    expect(bars).toEqual([
      { yearMonth: { year: 2025, month: 1 }, delta: undefined, total: 10 },
      { yearMonth: { year: 2025, month: 2 }, delta: 15, total: 25 },
      { yearMonth: { year: 2025, month: 3 }, delta: 5, total: 30 },
    ])
  })

  test("leaves a month with no record unknown rather than zero", () => {
    const bars = monthlyBars(
      months([2025, 1, 10], [2025, 3, 30]),
      3,
      new Date(Date.UTC(2025, 3, 15))
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
      new Date(Date.UTC(2025, 3, 15))
    )
    expect(bars).toHaveLength(3)
    expect(bars[0]!.delta).toBeUndefined()
  })

  test("returns all-undefined when the repository has no history", () => {
    const bars = monthlyBars([], 2, new Date(Date.UTC(2025, 3, 15)))
    expect(bars.every((bar) => bar.delta === undefined)).toBe(true)
  })
})

describe("periodTrends", () => {
  test("measures the year against the same month a year back", () => {
    const trends = periodTrends(
      months([2024, 3, 100], [2024, 4, 140], [2025, 3, 260], [2025, 4, 300])
    )
    expect(trends.month).toBe(40)
    // 300 now against 140 in the same month a year back: 160 over a year.
    expect(trends.year).toBe(160)
    expect(trends.total).toBe(300)
  })

  test("leaves the year unknown without a month a year back", () => {
    const trends = periodTrends(months([2025, 3, 260], [2025, 4, 300]))
    expect(trends.year).toBeUndefined()
    expect(trends.month).toBe(40)
  })

  test("reads the week from the weekly table, which is a gain not a total", () => {
    const trends = periodTrends(months([2025, 3, 10], [2025, 4, 20]), [
      { year: 2025, week: 10, stars: 4 },
      { year: 2025, week: 11, stars: 9 },
      { year: 2025, week: 12, stars: 6 },
    ])
    expect(trends.week).toBe(6)
  })

  test("does not invent a week when the weekly table is empty", () => {
    const trends = periodTrends(months([2025, 3, 10], [2025, 4, 20]), [])
    expect(trends.week).toBeUndefined()
    expect(trends.total).toBe(20)
  })

  test("returns every figure unknown with no history at all", () => {
    expect(periodTrends([])).toEqual({
      week: undefined,
      month: undefined,
      year: undefined,
      total: undefined,
    })
  })
})

describe("latestWeekGain", () => {
  test("takes the highest ISO week, not the last row", () => {
    expect(
      latestWeekGain([
        { year: 2025, week: 12, stars: 6 },
        { year: 2025, week: 9, stars: 99 },
        { year: 2024, week: 52, stars: 99 },
      ])
    ).toBe(6)
  })

  test("is undefined with no weekly rows", () => {
    expect(latestWeekGain([])).toBeUndefined()
  })
})

describe("lastNWeeks", () => {
  test("ends on the week containing now, oldest first", () => {
    const weeks = lastNWeeks(3, new Date(Date.UTC(2025, 0, 15)))
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
    const weeks = lastNWeeks(3, new Date(Date.UTC(2025, 0, 3)))
    expect(weeks[0]!.year).toBe(2024)
    expect(weeks[2]!.year).toBe(2025)
  })
})
