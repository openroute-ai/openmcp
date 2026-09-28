import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resetSyncEnvCache } from "@/lib/env"
import {
  isDue,
  matchesCron,
  parseCron,
  SCHEDULE_TIMEZONE,
  TASK_SEEDS,
  zonedParts,
} from "@/lib/tasks/definitions"
import {
  installTaskRegistry,
  resetInstalledTasks,
  UNIMPLEMENTED_TASKS,
} from "@/lib/tasks/registry"

const SHANGHAI = SCHEDULE_TIMEZONE

describe("parseCron", () => {
  it("parses a five-field expression", () => {
    const cron = parseCron("0 2 * * *")
    expect([...cron.minute]).toEqual([0])
    expect([...cron.hour]).toEqual([2])
    expect(cron.dayOfMonth.size).toBe(31)
    expect(cron.dayOfWeek.size).toBe(7)
  })

  it("expands a wildcard with a step", () => {
    expect([...parseCron("*/15 * * * *").minute]).toEqual([0, 15, 30, 45])
  })

  it("expands a list of values", () => {
    expect([...parseCron("0,30 * * * *").minute]).toEqual([0, 30])
  })

  it("expands an explicit range", () => {
    expect([...parseCron("0 9-11 * * *").hour]).toEqual([9, 10, 11])
  })

  it("treats a bare number with a step as a range to the field's end", () => {
    expect([...parseCron("5/20 * * * *").minute]).toEqual([5, 25, 45])
  })

  it("treats 7 as Sunday, like 0", () => {
    expect([...parseCron("0 0 * * 7").dayOfWeek]).toEqual([0])
    expect([...parseCron("0 0 * * 0").dayOfWeek]).toEqual([0])
  })

  it("rejects the wrong number of fields", () => {
    expect(() => parseCron("0 2 * *")).toThrow(/5 fields/)
    expect(() => parseCron("0 2 * * * *")).toThrow(/5 fields/)
  })

  it("rejects a value outside the field's range", () => {
    // 24 is not an hour, and a schedule that silently means midnight would be
    // worse than one that refuses to load.
    expect(() => parseCron("0 24 * * *")).toThrow(/out of range/)
    expect(() => parseCron("60 * * * *")).toThrow(/out of range/)
    expect(() => parseCron("0 0 * * 8")).toThrow(/out of range/)
  })

  it("rejects a reversed range", () => {
    expect(() => parseCron("0 11-9 * * *")).toThrow(/out of range/)
  })

  it("rejects a non-numeric field", () => {
    expect(() => parseCron("a b * * *")).toThrow(/out of range|Invalid/)
  })
})

describe("zonedParts", () => {
  it("reads wall-clock fields in the requested timezone", () => {
    // 18:30 UTC is 02:30 the next day in Shanghai, which is UTC+8.
    const parts = zonedParts(new Date("2026-03-10T18:30:00Z"), SHANGHAI)
    expect(parts.hour).toBe(2)
    expect(parts.minute).toBe(30)
    expect(parts.day).toBe(11)
    expect(parts.month).toBe(3)
  })

  it("gives midnight as hour zero", () => {
    // Intl renders midnight as "24" in some locales; a schedule of "0 0"
    // must still match it.
    const parts = zonedParts(new Date("2026-03-10T16:00:00Z"), SHANGHAI)
    expect(parts.hour).toBe(0)
  })

  it("names the day of week", () => {
    expect(zonedParts(new Date("2026-03-09T00:00:00Z"), "UTC").dayOfWeek).toBe(1)
    expect(zonedParts(new Date("2026-03-15T00:00:00Z"), "UTC").dayOfWeek).toBe(0)
  })
})

describe("matchesCron", () => {
  it("matches an exact daily time in the schedule timezone", () => {
    // 02:00 Shanghai on 11 March is 18:00 UTC on 10 March.
    const at = new Date("2026-03-10T18:00:00Z")
    expect(matchesCron("0 2 * * *", at, SHANGHAI)).toBe(true)
    expect(matchesCron("0 3 * * *", at, SHANGHAI)).toBe(false)
  })

  it("does not match the same clock time in the wrong timezone", () => {
    // The whole reason the timezone is explicit: 02:00 UTC is 10:00 Shanghai.
    const at = new Date("2026-03-10T02:00:00Z")
    expect(matchesCron("0 2 * * *", at, "UTC")).toBe(true)
    expect(matchesCron("0 2 * * *", at, SHANGHAI)).toBe(false)
  })

  it("matches every day when both day fields are wildcards", () => {
    expect(matchesCron("0 2 * * *", new Date("2026-03-11T02:00:00Z"), "UTC")).toBe(true)
    expect(matchesCron("0 2 * * *", new Date("2026-03-15T02:00:00Z"), "UTC")).toBe(true)
  })

  it("matches a day-of-month schedule", () => {
    // The monthly rankings run on the 1st.
    expect(matchesCron("0 3 1 * *", new Date("2026-03-01T03:00:00Z"), "UTC")).toBe(true)
    expect(matchesCron("0 3 1 * *", new Date("2026-03-02T03:00:00Z"), "UTC")).toBe(false)
  })

  it("matches a day-of-week schedule", () => {
    // 2026-03-09 is a Monday.
    expect(matchesCron("0 8 * * 1", new Date("2026-03-09T08:00:00Z"), "UTC")).toBe(true)
    expect(matchesCron("0 8 * * 1", new Date("2026-03-10T08:00:00Z"), "UTC")).toBe(false)
  })

  it("applies cron's OR rule when both day fields are restricted", () => {
    // Standard cron: with day-of-month and day-of-week both restricted, a
    // date matching either one is due.
    const cron = "0 0 15 * 1"
    expect(matchesCron(cron, new Date("2026-03-15T00:00:00Z"), "UTC")).toBe(true) // 15th
    expect(matchesCron(cron, new Date("2026-03-16T00:00:00Z"), "UTC")).toBe(true) // Monday
    expect(matchesCron(cron, new Date("2026-03-17T00:00:00Z"), "UTC")).toBe(false) // neither
  })

  it("requires every field to match", () => {
    // 18:00 UTC on 10 March is 02:00 on 11 March in Shanghai, so the
    // day-of-month field must be 11 here, not 10.
    const at = new Date("2026-03-10T18:00:00Z")
    expect(matchesCron("30 2 * * *", at, SHANGHAI)).toBe(false)
    expect(matchesCron("0 2 11 * *", at, SHANGHAI)).toBe(true)
    expect(matchesCron("0 2 10 * *", at, SHANGHAI)).toBe(false)
  })
})

describe("isDue", () => {
  it("uses the expression when there is one", () => {
    // isDue evaluates in the schedule timezone, so 18:00 UTC is the 02:00
    // Shanghai slot this task fires on.
    const seed = { cronExpression: "0 2 * * *", isDaily: true }
    expect(isDue(seed, new Date("2026-03-10T18:00:00Z"))).toBe(true)
    expect(isDue(seed, new Date("2026-03-10T19:00:00Z"))).toBe(false)
  })

  it("falls back to the daily flag when there is no expression", () => {
    // A definition stored with no schedule is treated as daily, matching the
    // source scheduler's default.
    expect(isDue({ cronExpression: "", isDaily: true }, new Date())).toBe(true)
    expect(isDue({ cronExpression: "", isWeekly: true }, new Date())).toBe(false)
  })
})

describe("TASK_SEEDS", () => {
  it("has a unique name for every task", () => {
    const names = TASK_SEEDS.map((seed) => seed.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("gives every task a parseable cron expression", () => {
    for (const seed of TASK_SEEDS) {
      expect(() => parseCron(seed.cronExpression), seed.name).not.toThrow()
    }
  })

  it("carries a description for every task", () => {
    for (const seed of TASK_SEEDS) {
      expect(seed.description.length, seed.name).toBeGreaterThan(0)
      expect(seed.taskType.length, seed.name).toBeGreaterThan(0)
    }
  })

  it("keeps the daily tasks at distinct times so they do not collide", () => {
    // Several of these depend on each other's output, so overlapping start
    // times would mean running a ranking build on half-written input.
    const times = TASK_SEEDS.filter((seed) => seed.isDaily).map(
      (seed) => seed.cronExpression.split(" ")[0] + " " + seed.cronExpression.split(" ")[1]
    )
    expect(new Set(times).size).toBe(times.length)
  })
})

describe("task registry", () => {
  const previousToken = process.env.GITHUB_ACCESS_TOKEN

  beforeAll(() => {
    // The clients are constructed here and only read the token; no request is
    // made. A dummy is enough, and a missing one would throw at import.
    process.env.GITHUB_ACCESS_TOKEN = "test-token"
    resetSyncEnvCache()
  })

  afterAll(() => {
    if (previousToken === undefined) {
      delete process.env.GITHUB_ACCESS_TOKEN
    } else {
      process.env.GITHUB_ACCESS_TOKEN = previousToken
    }
    resetSyncEnvCache()
    resetInstalledTasks()
  })

  it("has an implementation for every task it does not declare unimplemented", () => {
    const registry = installTaskRegistry()
    const seeded = TASK_SEEDS.map((seed) => seed.name)

    for (const name of seeded) {
      if (UNIMPLEMENTED_TASKS.has(name)) continue
      expect(registry.has(name), `${name} has no implementation`).toBe(true)
    }
  })

  it("declares every unimplemented task as one that is seeded", () => {
    // The reverse direction matters too: an implementation that no schedule
    // ever runs is dead code that looks live.
    const seeded = new Set(TASK_SEEDS.map((seed) => seed.name))

    for (const name of UNIMPLEMENTED_TASKS) {
      expect(seeded.has(name), `${name} is unimplemented but not seeded`).toBe(
        true
      )
    }
  })

  it("registers nothing outside the seed set", () => {
    const seeded = new Set(TASK_SEEDS.map((seed) => seed.name))

    for (const name of installTaskRegistry().keys()) {
      expect(seeded.has(name), `${name} is registered but never scheduled`).toBe(
        true
      )
    }
  })

  it("is idempotent, so a reused instance does not rebuild it", () => {
    const first = installTaskRegistry()
    expect(installTaskRegistry()).toBe(first)
  })

  it("registers a name matching each task's own name", async () => {
    // A mismatch would only surface at run time, as a task that resolves to
    // another task entirely.
    const registry = installTaskRegistry()

    for (const [key, task] of registry) {
      expect(task.name, key).toBe(key)
    }
  })
})
