/**
 * Tests that the Vercel schedule and the task seeds agree.
 *
 * `vercel.json` is static and the schedules live in TypeScript, so nothing
 * stops them drifting apart. The failure mode is quiet: Vercel keeps waking
 * the endpoint, the endpoint reports nothing due, and every task silently
 * stops running. Cheap to check, expensive to discover.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  matchesCron,
  SCHEDULE_TIMEZONE,
  TASK_SEEDS,
  zonedParts,
} from "@/lib/tasks/definitions"
import { periodTargets } from "@/lib/tasks/schedule"
import { VERCEL_CRON_PATH, VERCEL_CRON_SCHEDULE } from "@/lib/tasks/vercel-cron"

const vercel = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8")
) as { crons: { path: string; schedule: string }[] }

/** The first instant of a day, in UTC, that the wake-up schedule matches. */
function firstWakeUp(from = new Date("2026-03-11T00:00:00Z")): Date {
  for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
    const at = new Date(from.getTime() + minutes * 60_000)
    if (matchesCron(VERCEL_CRON_SCHEDULE, at, "UTC")) return at
  }
  throw new Error(`${VERCEL_CRON_SCHEDULE} never matches in a day`)
}

/** How many times the wake-up schedule matches in one day. */
function wakeUpsPerDay(): number {
  const from = new Date("2026-03-11T00:00:00Z")
  let count = 0
  for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
    if (
      matchesCron(
        VERCEL_CRON_SCHEDULE,
        new Date(from.getTime() + minutes * 60_000),
        "UTC"
      )
    ) {
      count += 1
    }
  }
  return count
}

describe("vercel cron wiring", () => {
  it("wakes the route the Cron handler serves", () => {
    expect(vercel.crons.map((cron) => cron.path)).toContain(VERCEL_CRON_PATH)
  })

  it("uses the documented schedule", () => {
    // One entry only: Vercel allows one per project, and the tasks are
    // separated by their own periods rather than by separate wake-ups.
    expect(vercel.crons).toHaveLength(1)
    expect(vercel.crons[0]?.schedule).toBe(VERCEL_CRON_SCHEDULE)
  })

  it("wakes once a day, which is what a Hobby plan allows", () => {
    // More than one wake-up a day needs a paid plan, and a second wake-up would
    // not run anything extra: a task whose period is already done is skipped.
    expect(wakeUpsPerDay()).toBe(1)
  })

  it("wakes in the morning in Asia/Shanghai, not in the middle of the day", () => {
    // The seeds are written in Asia/Shanghai, and 18:00 UTC is 02:00 there.
    // Reading the wake-up in UTC instead would start the pipeline eight hours
    // early, before the day's data was meant to be refreshed.
    const parts = zonedParts(firstWakeUp(), SCHEDULE_TIMEZONE)
    expect(parts.hour).toBe(2)
    expect(parts.minute).toBe(0)
  })

  it("reaches every seeded task from the one wake-up", () => {
    // The important property, and the reason the wake-up does not have to land
    // on any minute a seed uses: at its wake-up, every seeded task is offered a
    // period to run. A seed nothing reaches would run only by accident.
    const wakeUp = firstWakeUp()
    const silent = TASK_SEEDS.filter(
      (seed) => periodTargets(seed, wakeUp).length === 0
    ).map((seed) => `${seed.name} (${seed.cronExpression})`)

    expect(silent).toEqual([])
  })

  it("does not depend on a wake-up landing on a seed's minute", () => {
    // A task added at 17:47 has never been woken at 17:47, and must not need
    // to be: the schedule file is not the place a new task has to be declared.
    const onTheHalfHour = periodTargets(
      { taskType: "daily", cronExpression: "47 17 * * *" },
      firstWakeUp()
    )
    expect(onTheHalfHour.length).toBeGreaterThan(0)
  })
})
