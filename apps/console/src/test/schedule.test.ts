/**
 * Tests for the cadence and period rules the Cron cascade runs on.
 *
 * The property that matters is that a single daily wake-up stands in for
 * fifteen separate schedules without losing or repeating any of them. That is
 * a claim about wall-clock time in a named timezone, so these are written as
 * instants plus what a reader in Shanghai would call them, rather than as
 * arithmetic on UTC fields.
 */
import { describe, expect, it } from "vitest"
import { SCHEDULE_TIMEZONE, TASK_SEEDS } from "@/lib/tasks/definitions"
import {
  cadenceOf,
  MAX_ATTEMPTS_PER_PERIOD,
  periodKeyOf,
  periodStart,
  nextDueInstant,
  nextRunAt,
  periodTargets,
  selectPeriod,
  shiftPeriod,
  type PeriodState,
  type PeriodTarget,
} from "@/lib/tasks/schedule"

const SHANGHAI = SCHEDULE_TIMEZONE

/** A wall-clock moment in Shanghai, as the instant it really is. */
function shanghai(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
) {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000
  )
}

/** The period keys a task is offered at a moment, in the order offered. */
function keysAt(
  definition: {
    taskType?: string | null
    cronExpression?: string | null
    isDaily?: boolean | null
    isWeekly?: boolean | null
    isMonthly?: boolean | null
  },
  now: Date
): string[] {
  return periodTargets(definition, now).map((target) => target.key)
}

describe("cadenceOf", () => {
  it("prefers the task type the source scheduler carried", () => {
    expect(cadenceOf({ taskType: "yearly" })).toBe("yearly")
    expect(cadenceOf({ taskType: "  Weekly " })).toBe("weekly")
    // The type wins over the flags, which are only a fallback for older rows.
    expect(cadenceOf({ taskType: "monthly", isDaily: true })).toBe("monthly")
  })

  it("falls back to the coarse flags of an older row", () => {
    expect(cadenceOf({ taskType: "custom", isDaily: true })).toBe("daily")
    expect(cadenceOf({ taskType: "custom", isWeekly: true })).toBe("weekly")
    expect(cadenceOf({ taskType: "custom", isMonthly: true })).toBe("monthly")
  })

  it("reads the cadence off an unclassified expression", () => {
    expect(cadenceOf({ taskType: "batch", cronExpression: "0 4 * * *" })).toBe(
      "daily"
    )
    expect(cadenceOf({ taskType: "batch", cronExpression: "0 8 * * 1" })).toBe(
      "weekly"
    )
    expect(cadenceOf({ taskType: "batch", cronExpression: "0 3 1 * *" })).toBe(
      "monthly"
    )
    expect(cadenceOf({ taskType: "batch", cronExpression: "0 12 1 1 *" })).toBe(
      "yearly"
    )
  })

  it("refuses to guess when nothing classifies it", () => {
    // A task with no type, no flags and no expression is not schedulable, and
    // running it daily on a guess would be worse than not running it.
    expect(cadenceOf({})).toBeUndefined()
    expect(cadenceOf({ taskType: "batch" })).toBeUndefined()
  })
})

describe("periods", () => {
  it("names a day, a week, a month and a year", () => {
    // 11 March 2026 is a Wednesday, so its week is the one starting the 9th.
    const date = { year: 2026, month: 3, day: 11 }
    expect(periodKeyOf("daily", date)).toBe("2026-03-11")
    expect(periodKeyOf("weekly", date)).toBe("2026-03-09")
    expect(periodKeyOf("monthly", date)).toBe("2026-03")
    expect(periodKeyOf("yearly", date)).toBe("2026")
  })

  it("puts every day of a week in the same period", () => {
    const monday = { year: 2026, month: 3, day: 9 }
    const sunday = { year: 2026, month: 3, day: 15 }
    expect(periodKeyOf("weekly", monday)).toBe(periodKeyOf("weekly", sunday))
  })

  it("shifts across month and year boundaries", () => {
    expect(shiftPeriod("daily", "2026-03-01", -1)).toBe("2026-02-28")
    expect(shiftPeriod("monthly", "2026-01", -1)).toBe("2025-12")
    expect(shiftPeriod("monthly", "2026-12", 1)).toBe("2027-01")
    // A leap February has to survive being shifted off its own length.
    expect(shiftPeriod("monthly", "2024-02", 1)).toBe("2024-03")
    expect(shiftPeriod("monthly", "2024-03", -1)).toBe("2024-02")
    expect(shiftPeriod("yearly", "2026", -1)).toBe("2025")
    expect(shiftPeriod("weekly", "2026-03-09", -1)).toBe("2026-03-02")
  })

  it("starts a period at local midnight, not at UTC midnight", () => {
    // Shanghai is UTC+8, so a day starts at 16:00 UTC the day before. Reading
    // the key as a UTC date would put every period eight hours early.
    expect(periodStart("daily", "2026-03-11", SHANGHAI).toISOString()).toBe(
      "2026-03-10T16:00:00.000Z"
    )
    expect(periodStart("monthly", "2026-03", SHANGHAI).toISOString()).toBe(
      "2026-02-28T16:00:00.000Z"
    )
    expect(periodStart("yearly", "2026", SHANGHAI).toISOString()).toBe(
      "2025-12-31T16:00:00.000Z"
    )
  })
})

describe("periodTargets", () => {
  const daily = { taskType: "daily", cronExpression: "0 4 * * *" }

  it("offers yesterday and today once today's slot has passed", () => {
    // 06:00 on 11 March: the 04:00 slot for today has arrived, and the one for
    // yesterday is still outstanding if it was missed.
    expect(keysAt(daily, shanghai(2026, 3, 11, 6))).toEqual([
      "2026-03-10",
      "2026-03-11",
    ])
  })

  it("offers only yesterday before today's slot has arrived", () => {
    // The same task at 02:00, which is the wake-up. Today has not reached 04:00
    // yet, so today's period is not open and must not be run early.
    expect(keysAt(daily, shanghai(2026, 3, 11, 2))).toEqual(["2026-03-10"])
  })

  it("treats the slot minute itself as passed", () => {
    expect(
      keysAt(
        { taskType: "daily", cronExpression: "0 2 * * *" },
        shanghai(2026, 3, 11, 2)
      )
    ).toEqual(["2026-03-10", "2026-03-11"])
    // And not one minute before it.
    expect(
      keysAt(
        { taskType: "daily", cronExpression: "0 2 * * *" },
        shanghai(2026, 3, 11, 1, 59)
      )
    ).toEqual(["2026-03-10"])
  })

  it("never offers the same period twice", () => {
    // 04:00 sharp: today's slot is due, and today's period appears once.
    const keys = keysAt(daily, shanghai(2026, 3, 11, 4))
    expect(keys).toEqual(["2026-03-10", "2026-03-11"])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("follows the week for a weekly task", () => {
    const weekly = { taskType: "weekly", cronExpression: "0 8 * * 1" }

    // Monday 02:00: the current week has started but its Monday 08:00 slot has
    // not, so the week that was missed is the only one on offer.
    expect(keysAt(weekly, shanghai(2026, 3, 9, 2))).toEqual(["2026-03-02"])
    // Monday 10:00, after that slot: both weeks are open.
    expect(keysAt(weekly, shanghai(2026, 3, 9, 10))).toEqual([
      "2026-03-02",
      "2026-03-09",
    ])
    // Tuesday 02:00: last week is still on offer, so a run missed on Monday is
    // not lost just because the week turned over.
    expect(keysAt(weekly, shanghai(2026, 3, 10, 2))).toEqual([
      "2026-03-02",
      "2026-03-09",
    ])
  })

  it("follows the month for a monthly task", () => {
    const monthly = { taskType: "monthly", cronExpression: "0 3 1 * *" }

    expect(keysAt(monthly, shanghai(2026, 3, 1, 2))).toEqual(["2026-02"])
    expect(keysAt(monthly, shanghai(2026, 3, 1, 4))).toEqual([
      "2026-02",
      "2026-03",
    ])
    // The 2nd: last month's report is still outstanding, which is what a
    // deployment outage on the 1st leaves behind.
    expect(keysAt(monthly, shanghai(2026, 3, 2, 2))).toEqual([
      "2026-02",
      "2026-03",
    ])
  })

  it("follows the year for a yearly task", () => {
    const yearly = { taskType: "yearly", cronExpression: "0 12 1 1 *" }

    // Midday on New Year's Day: the twelve months before it are all on record,
    // and the year they belong to is the one that just ended.
    expect(keysAt(yearly, shanghai(2026, 1, 1, 13))).toEqual(["2025", "2026"])
    expect(keysAt(yearly, shanghai(2026, 1, 1, 2))).toEqual(["2025"])
  })

  it("uses the cadence alone when there is no expression", () => {
    expect(keysAt({ taskType: "daily" }, shanghai(2026, 3, 11, 6))).toEqual([
      "2026-03-11",
    ])
    expect(
      keysAt({ cronExpression: "", isDaily: true }, shanghai(2026, 3, 11, 6))
    ).toEqual(["2026-03-11"])
  })

  it("offers nothing for a definition with no cadence", () => {
    expect(keysAt({ taskType: "batch" }, new Date())).toEqual([])
  })

  it("offers no period an expression does not reach", () => {
    // A daily task carrying a monthly expression has nothing due on a day that
    // is not the 1st: neither yesterday nor today is a day the expression
    // fires, so the cascade must not invent a run for it.
    expect(
      keysAt(
        { taskType: "daily", cronExpression: "0 3 1 * *" },
        shanghai(2026, 3, 11, 6)
      )
    ).toEqual([])
  })

  it("refuses an unparseable expression rather than running everything", () => {
    expect(() =>
      periodTargets(
        { taskType: "daily", cronExpression: "0 99 * * *" },
        shanghai(2026, 3, 11, 6)
      )
    ).toThrow(/out of range/)
  })
})

describe("selectPeriod", () => {
  const targets = periodTargets(
    { taskType: "monthly", cronExpression: "0 3 1 * *" },
    shanghai(2026, 3, 1, 4)
  )

  /** The period a tick picks when each target has this state. */
  async function selected(...states: PeriodState[]) {
    const asked: PeriodTarget[] = []
    const choice = await selectPeriod(targets, (target) => {
      asked.push(target)
      return (
        states[targets.indexOf(target)] ?? { completed: false, attempts: 0 }
      )
    })
    return { choice, askedFor: asked.length }
  }

  it("takes the oldest period that has no run yet", async () => {
    expect((await selected({ completed: false, attempts: 0 })).choice).toEqual({
      kind: "due",
      target: targets[0],
    })
  })

  it("moves to the current period once the older one is done", async () => {
    const { choice } = await selected(
      { completed: true, attempts: 1 },
      { completed: false, attempts: 0 }
    )
    expect(choice).toEqual({ kind: "due", target: targets[1] })
  })

  it("reports done when every period is complete", async () => {
    const { choice } = await selected(
      { completed: true, attempts: 1 },
      { completed: true, attempts: 4 }
    )
    expect(choice.kind).toBe("done")
  })

  it("reports a period nobody could finish, rather than nothing to do", async () => {
    // The two read very differently in a run summary, and the difference is
    // whether anyone is going to look at it.
    const { choice } = await selected(
      { completed: false, attempts: MAX_ATTEMPTS_PER_PERIOD },
      { completed: false, attempts: 0 }
    )
    expect(choice).toEqual({ kind: "due", target: targets[1] })

    const stuck = await selected(
      { completed: false, attempts: MAX_ATTEMPTS_PER_PERIOD },
      { completed: false, attempts: MAX_ATTEMPTS_PER_PERIOD }
    )
    expect(stuck.choice.kind).toBe("exhausted")
  })

  it("still retries a failed period until the cap", async () => {
    expect(
      (await selected({ completed: false, attempts: 1 })).choice.kind
    ).toBe("due")
    const last = await selected({
      completed: false,
      attempts: MAX_ATTEMPTS_PER_PERIOD - 1,
    })
    expect(last.choice.kind).toBe("due")
  })

  it("asks about as few periods as it can", async () => {
    // Most ticks have something to run in the oldest period, and the second
    // period does not need a database round trip to be offered at all.
    expect((await selected({ completed: false, attempts: 0 })).askedFor).toBe(1)
  })

  it("reads the state from a promise", async () => {
    // How the Cron route supplies it: the period's history is in the database.
    const choice = await selectPeriod(targets, async (target) => ({
      completed: targets.indexOf(target) === 0,
      attempts: 0,
    }))
    expect(choice).toEqual({ kind: "due", target: targets[1] })
  })
})

describe("nextDueInstant", () => {
  const next = (expression: string, at: Date) =>
    nextDueInstant(expression, at, { timeZone: SHANGHAI })?.toISOString()

  it("finds the next slot on the same day", () => {
    expect(next("0 2 * * *", shanghai(2026, 3, 11, 1))).toBe(
      "2026-03-10T18:00:00.000Z"
    )
  })

  it("moves to the next day once the slot has passed", () => {
    expect(next("0 2 * * *", shanghai(2026, 3, 11, 3))).toBe(
      "2026-03-11T18:00:00.000Z"
    )
  })

  it("does not offer a minute that has already started", () => {
    // 02:00:30 has passed 02:00, so the next 02:00 is tomorrow's. Comparing
    // minutes instead of instants would promise one that is already behind.
    expect(
      next("0 2 * * *", new Date(shanghai(2026, 3, 11, 2).getTime() + 30_000))
    ).toBe("2026-03-11T18:00:00.000Z")
  })

  it("offers the very instant when the answer is inclusive", () => {
    const at = shanghai(2026, 3, 11, 2)
    expect(
      nextDueInstant("0 2 * * *", at, {
        timeZone: SHANGHAI,
        inclusive: true,
      })?.toISOString()
    ).toBe(at.toISOString())
  })

  it("counts forward to a weekly or yearly slot", () => {
    // Monday 9 March 2026 is a Monday, so the next Monday 08:00 is the 16th.
    expect(next("0 8 * * 1", shanghai(2026, 3, 9, 9))).toBe(
      "2026-03-16T00:00:00.000Z"
    )
    expect(next("0 12 1 1 *", shanghai(2026, 3, 11, 2))).toBe(
      "2027-01-01T04:00:00.000Z"
    )
  })

  it("reads the clock in the timezone it was given", () => {
    // The same instant is a different moment in each zone: 18:00 UTC on the
    // 10th is already 02:00 on the 11th in Shanghai, so the next UTC 02:00 is
    // eight hours later on the 11th rather than the slot Shanghai just passed.
    const at = shanghai(2026, 3, 11, 2)
    expect(
      nextDueInstant("0 2 * * *", at, { timeZone: "UTC" })?.toISOString()
    ).toBe("2026-03-11T02:00:00.000Z")
  })
})

describe("nextRunAt", () => {
  const daily = { taskType: "daily", cronExpression: "0 4 * * *" }
  const caught = () => ({ completed: true, attempts: 1 })
  const outstanding = () => ({ completed: false, attempts: 0 })

  it("is the next wake-up while a period is still open", async () => {
    // 04:00 has not arrived at 02:00, so yesterday's period is outstanding and
    // this morning's wake-up runs it.
    const at = await nextRunAt(daily, outstanding, shanghai(2026, 3, 11, 2))
    expect(at?.toISOString()).toBe("2026-03-10T18:00:00.000Z")
  })

  it("is tomorrow's wake-up once everything is caught up", async () => {
    const at = await nextRunAt(daily, caught, shanghai(2026, 3, 11, 2))
    expect(at?.toISOString()).toBe("2026-03-11T18:00:00.000Z")
  })

  it("is today's wake-up before it has happened", async () => {
    // Asked at 01:00, the 02:00 wake-up is still ahead of the clock.
    const at = await nextRunAt(
      { taskType: "daily", cronExpression: "0 2 * * *" },
      outstanding,
      shanghai(2026, 3, 11, 1)
    )
    expect(at?.toISOString()).toBe("2026-03-10T18:00:00.000Z")
  })

  it("is the wake-up after the next yearly slot, for a yearly task", async () => {
    const at = await nextRunAt(
      { taskType: "yearly", cronExpression: "0 12 1 1 *" },
      caught,
      shanghai(2026, 3, 11, 2)
    )
    // Midday on 1 January 2027 Shanghai is 04:00 UTC, and the 02:00 wake-up that
    // runs it is the following morning.
    expect(at?.toISOString()).toBe("2027-01-01T18:00:00.000Z")
  })

  it("is undefined for a definition the scheduler cannot place", async () => {
    expect(
      await nextRunAt({ taskType: "batch" }, outstanding, new Date())
    ).toBe(undefined)
  })
})

describe("every seeded task is reachable from a single wake-up", () => {
  // The invariant the whole design rests on: at 02:00 Shanghai, one invocation
  // offers every seeded task something to do. If this fails, a task is running
  // only if the clock happened to land on its minute, which is exactly the
  // failure the cascade replaced.
  const WAKE_UP = shanghai(2026, 3, 11, 2)

  it("offers a period to every seed", () => {
    const silent = TASK_SEEDS.filter(
      (seed) => periodTargets(seed, WAKE_UP).length === 0
    ).map((seed) => seed.name)

    expect(silent).toEqual([])
  })

  it("reads the wall clock in Asia/Shanghai, not UTC", () => {
    // 18:00 UTC is 02:00 the next day in Shanghai. A scheduler reading the
    // clock in UTC would see 18:00 the day before, which no seed is scheduled
    // for, and would run the whole pipeline eight hours early.
    expect(
      periodTargets({ taskType: "daily", cronExpression: "0 2 * * *" }, WAKE_UP)
    ).toContainEqual({
      cadence: "daily",
      key: "2026-03-11",
      start: new Date("2026-03-10T16:00:00.000Z"),
    })
  })
})
