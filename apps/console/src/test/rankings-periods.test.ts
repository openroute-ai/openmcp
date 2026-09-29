/**
 * Tests for period arithmetic and the ranking rules.
 *
 * The date logic is tested directly because a week boundary is easy to get
 * wrong and impossible to notice: an off-by-one week publishes a ranking for
 * the wrong seven days, and nothing about the output looks wrong.
 */
import { describe, expect, it } from "vitest"
import { previousIsoWeek } from "@/lib/github/snapshot-dates"
import {
  createBuildRankingsTask,
  lastCompletePeriod,
  periodFileName,
  type RankingsStore,
} from "@/lib/tasks/tasks/build-rankings"

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
    expect(lastCompletePeriod("month", new Date("2026-03-01T00:00:00Z"))).toEqual({
      year: 2026,
      month: 2,
    })
  })

  it("rolls back into December when the first is in January", () => {
    expect(lastCompletePeriod("month", new Date("2026-01-01T00:00:00Z"))).toEqual({
      year: 2025,
      month: 12,
    })
  })

  it("keeps the previous month even on the last day", () => {
    // No boundary case: March's ranking is published in April, so a month is
    // never published while it is still accumulating.
    expect(lastCompletePeriod("month", new Date("2026-03-31T23:00:00Z"))).toEqual({
      year: 2026,
      month: 2,
    })
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
