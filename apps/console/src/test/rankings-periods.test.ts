/**
 * Tests for period arithmetic and the ranking rules.
 *
 * The date logic is tested directly because a week boundary is easy to get
 * wrong and impossible to notice: an off-by-one week publishes a ranking for
 * the wrong seven days, and nothing about the output looks wrong.
 */
import { describe, expect, it } from "vitest"
import { previousIsoWeek } from "@/lib/github/snapshot-dates"
import { defaultYear, resolveWeek, resolveWeekInput } from "@/lib/rankings-web"
import {
  createBuildRankingsTask,
  lastCompletePeriod,
  periodFileName,
  type RankingsStore,
} from "@/lib/tasks/tasks/build-rankings"
import { zonedCivilDate, zonedParts, zonedYear } from "@/lib/time"

const noStore: RankingsStore = {
  async saveJSON() {
    return undefined
  },
}

describe("previousIsoWeek", () => {
  it("steps back within a year", () => {
    expect(previousIsoWeek({ year: 2026, week: 10 })).toEqual({
      year: 2026,
      week: 9,
    })
  })

  it("steps across a year boundary", () => {
    // The case a naive `week - 1` gets wrong: 2026 week 1 follows 2025 week 52.
    expect(previousIsoWeek({ year: 2026, week: 1 })).toEqual({
      year: 2025,
      week: 52,
    })
  })

  it("knows a 53-week year exists", () => {
    // 2020 is an ISO year with 53 weeks, so 2021 week 1 follows 2020 week 53.
    // Hardcoding 52 would produce week 0 here.
    expect(previousIsoWeek({ year: 2021, week: 1 })).toEqual({
      year: 2020,
      week: 53,
    })
  })

  it("round-trips through getIsoWeekNumber", () => {
    // Walking forward from the answer must land back on the input week, for a
    // week whose predecessor is in a different ISO year.
    const answer = previousIsoWeek({ year: 2026, week: 1 })
    const mondayOfAnswer = new Date(Date.UTC(2025, 11, 29))
    expect(answer).toEqual({ year: 2025, week: 52 })
    expect(mondayOfAnswer.getUTCDay()).toBe(1)
  })
})

describe("lastCompletePeriod", () => {
  it("ranks last week, not this one, mid-week", () => {
    // Wednesday 4 March 2026. Ranking the current week would compare three
    // days against complete weeks.
    const wednesday = new Date("2026-03-04T12:00:00Z")
    const period = lastCompletePeriod("week", wednesday) as {
      year: number
      week: number
    }

    expect(period.week).toBe(9)
  })

  it("ranks the week that just ended on a Monday", () => {
    // Monday 2 March 2026: yesterday was inside the finished week 9, so that is
    // the newest complete one. Taking the current week here would rank one day.
    const monday = new Date("2026-03-02T12:00:00Z")
    expect(lastCompletePeriod("week", monday)).toEqual({ year: 2026, week: 9 })
  })

  it("ranks last month, not this one, mid-month", () => {
    const period = lastCompletePeriod("month", new Date("2026-03-15T00:00:00Z"))

    expect(period).toEqual({ year: 2026, month: 2 })
  })

  it("ranks the month that just ended on the first", () => {
    expect(
      lastCompletePeriod("month", new Date("2026-03-01T00:00:00Z"))
    ).toEqual({
      year: 2026,
      month: 2,
    })
  })

  it("rolls back into December when the first is in January", () => {
    expect(
      lastCompletePeriod("month", new Date("2026-01-01T00:00:00Z"))
    ).toEqual({
      year: 2025,
      month: 12,
    })
  })

  it("keeps the previous month even on its last day", () => {
    // No boundary case: 23:59 on 31 March in Beijing is still March, so March
    // is still accumulating and February is the newest complete month. A month
    // is never published while it is running.
    expect(
      lastCompletePeriod("month", new Date("2026-03-31T15:59:00Z"))
    ).toEqual({
      year: 2026,
      month: 2,
    })
  })

  it("publishes the month at Beijing midnight, not at UTC midnight", () => {
    // The same instant the old rule answered for on a UTC server: Beijing is
    // already on 1 April, March is over, and March is the period to publish.
    expect(
      lastCompletePeriod("month", new Date("2026-03-31T16:00:00Z"))
    ).toEqual({
      year: 2026,
      month: 3,
    })
  })
})

/**
 * The eight hours a day when Beijing and UTC disagree about the calendar.
 *
 * A Vercel instance is on UTC, so the server's own date is the wrong one to
 * answer "which period just finished" with. Every case below is a moment where
 * the two zones name a different day, week, month or year, and the UTC answer is
 * the one this app used to give.
 */
describe("periods are Beijing periods", () => {
  it("counts the new Beijing week at Beijing midnight on a Monday", () => {
    // 16:30Z on Sunday is 00:30 on Monday in Beijing: week 10 has begun there
    // and week 9 is the newest complete one. UTC is still inside week 9 and
    // would answer week 8.
    expect(
      lastCompletePeriod("week", new Date("2026-03-01T16:30:00Z"))
    ).toEqual({ year: 2026, week: 9 })
  })

  it("waits for the new Beijing week rather than publishing ahead of it", () => {
    // 15:30Z on Sunday is still 23:30 on Sunday in Beijing, so week 10 has not
    // started and week 9 has not finished either: the answer is week 8.
    expect(
      lastCompletePeriod("week", new Date("2026-03-01T15:30:00Z"))
    ).toEqual({ year: 2026, week: 8 })
  })

  it("counts the new Beijing month at Beijing midnight on the first", () => {
    // 16:30Z on 28 February is 00:30 on 1 March in Beijing, so February is the
    // month that just ended. UTC is still in February and answers January.
    expect(
      lastCompletePeriod("month", new Date("2026-02-28T16:30:00Z"))
    ).toEqual({ year: 2026, month: 2 })
  })

  it("counts the new Beijing year at Beijing midnight on New Year", () => {
    // 16:30Z on 31 December is 00:30 on 1 January in Beijing: 2025 has just
    // ended there and is the year a Rising Stars run defaults to. UTC is still
    // in 2025 and would report 2024.
    expect(defaultYear(new Date("2025-12-31T16:30:00Z"))).toBe(2025)
  })

  it("has not turned the year over before Beijing midnight", () => {
    expect(defaultYear(new Date("2025-12-31T15:30:00Z"))).toBe(2024)
  })

  it("defaults a bare week to the Beijing year", () => {
    expect(
      resolveWeekInput({ week: 10 }, new Date("2025-12-31T16:30:00Z"))
    ).toEqual({ ok: true, value: { year: 2026, week: 10 } })
  })

  it("resolves the public week endpoint to the Beijing week", () => {
    const resolved = resolveWeek(
      new URLSearchParams(),
      new Date("2026-03-01T16:30:00Z")
    )
    expect(resolved).toEqual({ ok: true, value: { year: 2026, week: 9 } })
  })
})

describe("zonedCivilDate", () => {
  it("reads as Beijing wall clock in UTC fields", () => {
    const civil = zonedCivilDate(new Date("2026-03-01T16:30:00Z"))
    expect(civil.toISOString()).toBe("2026-03-02T00:30:00.000Z")
  })

  it("agrees with the zone's own fields", () => {
    const instant = new Date("2026-07-04T02:15:30Z")
    // Read the shifted date in UTC: reading it in Shanghai again would apply
    // the offset twice, which is the mistake this helper exists to avoid.
    expect(zonedParts(zonedCivilDate(instant), "UTC")).toEqual(
      zonedParts(instant)
    )
  })

  it("leaves a UTC instant alone", () => {
    expect(
      zonedCivilDate(new Date("2026-03-01T16:30:00Z"), "UTC").toISOString()
    ).toBe("2026-03-01T16:30:00.000Z")
  })

  it("reports the year eight hours ahead of UTC", () => {
    expect(zonedYear(new Date("2025-12-31T16:30:00Z"))).toBe(2026)
    expect(zonedYear(new Date("2025-12-31T16:30:00Z"), "UTC")).toBe(2025)
  })
})

describe("ranking publication naming", () => {
  it("publishes a weekly file where the frontend looks for it", () => {
    // The public site enumerates `weekly/<year>/` and loads `<year>-W<0N>`.
    // A different shape silently orphans the file from the site.
    expect(periodFileName({ year: 2026, week: 9 })).toBe(
      "weekly/2026/2026-W09.json"
    )
  })

  it("publishes a monthly file where the frontend looks for it", () => {
    expect(periodFileName({ year: 2026, month: 2 })).toBe(
      "monthly/2026/2026-02.json"
    )
  })

  it("names the tasks after the periods the scheduler seeds", () => {
    // The seeds define build-weekly-rankings and build-monthly-rankings. A
    // mismatch here is silent: the cron route reports "no implementation" for
    // the scheduled name while the build actually exists under another one.
    expect(createBuildRankingsTask("week", noStore).name).toBe(
      "build-weekly-rankings"
    )
    expect(createBuildRankingsTask("month", noStore).name).toBe(
      "build-monthly-rankings"
    )
  })
})
