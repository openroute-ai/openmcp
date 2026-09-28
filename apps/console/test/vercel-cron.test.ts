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
import { TASK_SEEDS, matchesCron } from "@/lib/tasks/definitions"
import {
  VERCEL_CRON_PATH,
  VERCEL_CRON_SCHEDULE,
} from "@/lib/tasks/vercel-cron"

const vercel = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8")
) as { crons: { path: string; schedule: string }[] }

describe("vercel cron wiring", () => {
  it("wakes the route the Cron handler serves", () => {
    expect(vercel.crons.map((cron) => cron.path)).toContain(VERCEL_CRON_PATH)
  })

  it("uses the documented schedule", () => {
    // One entry only: Vercel allows one per project, and the tasks are
    // separated by their own expressions rather than by separate wake-ups.
    expect(vercel.crons).toHaveLength(1)
    expect(vercel.crons[0]?.schedule).toBe(VERCEL_CRON_SCHEDULE)
  })

  it("wakes on every minute a seeded task is scheduled for", () => {
    // The important property. A seed on an unwoken minute never runs, and
    // nothing in the app would report it as missing.
    //
    // Only the minute field is compared, and it is compared through
    // `matchesCron` so this tracks the real matcher rather than a second
    // parser. The probe date is arbitrary: the wake-up schedule has no
    // day, hour or month restriction, so any valid instant at the seed's
    // minute answers the question.
    const unwoken = TASK_SEEDS.filter((seed) => {
      if (!seed.cronExpression) return false
      return minutesOf(seed.cronExpression).some(
        (minute) =>
          !matchesCron(
            VERCEL_CRON_SCHEDULE,
            new Date(Date.UTC(2026, 0, 1, 0, minute)),
            "UTC"
          )
      )
    })

    expect(
      unwoken.map((seed) => `${seed.name} (${seed.cronExpression})`)
    ).toEqual([])
  })
})

/** Expands the minute field of a cron expression into the minutes it names. */
function minutesOf(expression: string): number[] {
  return expression
    .split(" ")[0]!
    .split(",")
    .flatMap((part) => {
      const [range, step] = part.split("/")
      const from = Number(range)
      const to = step ? 59 : from
      if (Number.isNaN(from)) return []
      return Array.from({ length: to - from + 1 }, (_, i) => from + i)
    })
}
