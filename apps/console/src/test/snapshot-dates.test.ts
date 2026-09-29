import { describe, expect, it } from "vitest"
import {
  countDaysBetween,
  daysInMonth,
  getIsoWeekEnd,
  getIsoWeekNumber,
  getIsoWeekStart,
  isInIsoWeek,
  isInMonth,
  monthEndExclusive,
  monthStart,
  type YearMonth,
} from "@/lib/github/snapshot-dates"

describe("getIsoWeekNumber", () => {
  it("matches the published ISO-8601 week numbers", () => {
    // Reference values computed from the ISO-8601 definition (weeks start on
    // Monday; week 1 contains the first Thursday of the year).
    expect(getIsoWeekNumber(new Date("2021-01-01T00:00:00Z"))).toEqual({
      year: 2020,
      week: 53,
    })
    expect(getIsoWeekNumber(new Date("2021-01-04T00:00:00Z"))).toEqual({
      year: 2021,
      week: 1,
    })
    expect(getIsoWeekNumber(new Date("2026-01-01T00:00:00Z"))).toEqual({
      year: 2026,
      week: 1,
    })
    expect(getIsoWeekNumber(new Date("2026-12-31T00:00:00Z"))).toEqual({
      year: 2026,
      week: 53,
    })
  })

  it("knows which years have 53 weeks", () => {
    // 2020 and 2026 have 53 ISO weeks; 2021 and 2022 have 52. A week-count
    // assumption is therefore not safe, which is why the year is carried
    // alongside the week number everywhere.
    expect(getIsoWeekNumber(new Date("2020-12-28T00:00:00Z")).week).toBe(53)
    expect(getIsoWeekNumber(new Date("2021-12-28T00:00:00Z")).week).toBe(52)
    expect(getIsoWeekNumber(new Date("2022-12-28T00:00:00Z")).week).toBe(52)
    expect(getIsoWeekNumber(new Date("2026-12-28T00:00:00Z")).week).toBe(53)
  })

  it("is unaffected by the time of day", () => {
    const morning = getIsoWeekNumber(new Date("2026-03-11T00:00:01Z"))
    const night = getIsoWeekNumber(new Date("2026-03-11T23:59:59Z"))
    expect(morning).toEqual(night)
  })

  it("puts Monday in the same week as the following Sunday", () => {
    const monday = getIsoWeekNumber(new Date("2026-03-09T00:00:00Z"))
    const sunday = getIsoWeekNumber(new Date("2026-03-15T00:00:00Z"))
    expect(monday).toEqual(sunday)
  })

  it("starts a new week on the following Monday", () => {
    const sunday = getIsoWeekNumber(new Date("2026-03-15T00:00:00Z"))
    const monday = getIsoWeekNumber(new Date("2026-03-16T00:00:00Z"))
    expect(monday.week).toBe(sunday.week + 1)
  })
})

describe("getIsoWeekStart / getIsoWeekEnd", () => {
  it("returns Monday and Sunday of the week", () => {
    const start = getIsoWeekStart({ year: 2026, week: 11 })
    expect(start.toISOString().slice(0, 10)).toBe("2026-03-09")
    expect(start.getUTCDay()).toBe(1)

    const end = getIsoWeekEnd({ year: 2026, week: 11 })
    expect(end.toISOString().slice(0, 10)).toBe("2026-03-15")
    expect(end.getUTCDay()).toBe(0)
  })

  it("puts 1 January in the ISO week of the year it belongs to", () => {
    // The boundary case the source app got wrong. 1 January 2021 is a
    // Friday, so it belongs to week 53 of 2020, whose week began on
    // 28 December 2020 - not to week 1 of 2021, which starts 4 January.
    expect(getIsoWeekStart({ year: 2020, week: 53 }).toISOString()).toBe(
      "2020-12-28T00:00:00.000Z"
    )
    expect(getIsoWeekStart({ year: 2021, week: 1 }).toISOString()).toBe(
      "2021-01-04T00:00:00.000Z"
    )
  })

  it("keeps the ISO year and the week in step", () => {
    // Only weeks that exist are round-tripped: asking for week 53 of a
    // 52-week year has no answer to give.
    for (const { year, week } of [
      { year: 2020, week: 53 },
      { year: 2021, week: 1 },
      { year: 2021, week: 52 },
      { year: 2026, week: 11 },
      { year: 2026, week: 53 },
    ]) {
      expect(getIsoWeekNumber(getIsoWeekStart({ year, week }))).toEqual({
        year,
        week,
      })
    }
  })

  it("spans exactly seven days", () => {
    const start = getIsoWeekStart({ year: 2026, week: 5 })
    const end = getIsoWeekEnd({ year: 2026, week: 5 })
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(6)
  })
})

describe("isInIsoWeek", () => {
  const week = { year: 2026, week: 11 }

  it("accepts every day of the week", () => {
    for (let day = 9; day <= 15; day += 1) {
      // ISO 8601 requires a two-digit day; an unpadded one is not a valid
      // date string and silently yields Invalid Date.
      const iso = `2026-03-${String(day).padStart(2, "0")}T12:00:00Z`
      expect(isInIsoWeek(new Date(iso), week)).toBe(true)
    }
  })

  it("rejects the days either side", () => {
    expect(isInIsoWeek(new Date("2026-03-08T23:59:59Z"), week)).toBe(false)
    expect(isInIsoWeek(new Date("2026-03-16T00:00:00Z"), week)).toBe(false)
  })

  it("files a 1 January snapshot under the ISO week that contains it", () => {
    const weekOfNewYear = getIsoWeekNumber(new Date("2021-01-01T00:00:00Z"))
    expect(weekOfNewYear).toEqual({ year: 2020, week: 53 })
    expect(isInIsoWeek(new Date("2021-01-01T00:00:00Z"), weekOfNewYear)).toBe(
      true
    )
  })
})

describe("month boundaries", () => {
  it("starts a month on the first at UTC midnight", () => {
    const start = monthStart({ year: 2026, month: 2 })
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z")
  })

  it("excludes the following month at the end", () => {
    const end = monthEndExclusive({ year: 2026, month: 2 })
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z")
  })

  it("handles a leap February", () => {
    const february2024: YearMonth = { year: 2024, month: 2 }
    expect(daysInMonth(february2024)).toBe(29)
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28)
    expect(daysInMonth({ year: 2026, month: 12 })).toBe(31)
  })

  it("rejects an impossible month rather than rolling it over", () => {
    expect(() => monthStart({ year: 2026, month: 13 })).toThrow()
    expect(() => monthStart({ year: 2026, month: 0 })).toThrow()
    expect(() => monthStart({ year: 2026, month: 1.5 })).toThrow()
  })

  it("treats the end of a month as exclusive", () => {
    const february: YearMonth = { year: 2026, month: 2 }
    expect(isInMonth(new Date("2026-02-28T23:59:59Z"), february)).toBe(true)
    expect(isInMonth(new Date("2026-03-01T00:00:00Z"), february)).toBe(false)
    expect(isInMonth(new Date("2026-01-31T23:59:59Z"), february)).toBe(false)
  })
})

describe("countDaysBetween", () => {
  it("counts whole days", () => {
    expect(
      countDaysBetween(
        new Date("2026-03-01T00:00:00Z"),
        new Date("2026-03-08T00:00:00Z")
      )
    ).toBe(7)
  })

  it("never returns a negative count", () => {
    expect(
      countDaysBetween(
        new Date("2026-03-08T00:00:00Z"),
        new Date("2026-03-01T00:00:00Z")
      )
    ).toBe(0)
  })

  it("counts a partial day as no day", () => {
    expect(
      countDaysBetween(
        new Date("2026-03-01T00:00:00Z"),
        new Date("2026-03-01T23:59:59Z")
      )
    ).toBe(0)
  })
})
