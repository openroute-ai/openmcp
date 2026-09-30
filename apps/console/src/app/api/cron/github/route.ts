/**
 * The single Cron entrypoint.
 *
 * Vercel Cron invokes one path on one schedule, so the whole schedule is
 * decided here. A task is not asked whether its own minute has arrived — that
 * cannot work from a single daily wake-up — but which *period* of work it is
 * owed, and whether that period still has work in it. See
 * `@/lib/tasks/schedule`: a task whose 04:00 slot has passed runs for today, and
 * one whose slot has not arrives yet catches up on the day it was missed.
 *
 * The endpoint fails closed. With no `CRON_SECRET` it returns 404 rather than
 * running anything, because a scheduler that writes to the database and pushes
 * webhooks must never degrade into an open trigger.
 *
 * Runs are sequential, not parallel, and in seed order rather than in the
 * alphabetical order the definitions come back from the database in. Several of
 * these tasks read what the previous one wrote — repository data feeds the
 * rankings, the rankings feed the notifications — and a serverless function
 * that fired them all at once, or in the wrong order, would notify on
 * half-written input. Each task also takes its own database lock, so a second
 * instance arriving mid-tick does not duplicate work.
 *
 * Cost of the cascade: a wake-up may run the whole pipeline, so the function is
 * declared at the longest duration Vercel offers and the tick that overruns
 * loses only the tasks it had not reached. Those are picked up by the next
 * wake-up, because a period nobody finished is still outstanding.
 */

import { db } from "@/db/client"
import { cronSecret } from "@/lib/env"
import { authorized } from "@/lib/cron/guard"
import { sortBySeedOrder } from "@/lib/tasks/definitions"
import { installTaskRegistry, UNIMPLEMENTED_TASKS } from "@/lib/tasks/registry"
import {
  getPeriodRunState,
  listTaskDefinitions,
} from "@/lib/github/service/task"
import { seedDefinitions } from "@/lib/tasks/seed"
import {
  MAX_ATTEMPTS_PER_PERIOD,
  periodTargets,
  selectPeriod,
} from "@/lib/tasks/schedule"
import {
  createBufferingLogger,
  getTaskRegistry,
  recoverStaleRuns,
  runTask,
  type RunOutcome,
} from "@/lib/tasks/runner"
import { NextResponse } from "next/server"

/**
 * Vercel's longest-running function tier. The GitHub refresh alone can spend
 * minutes on a large catalogue, and the default 10s would kill it mid-sweep,
 * leaving the lock held until staleness elapsed.
 */
export const maxDuration = 300

/** Not cached: every invocation must do work. */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const secret = cronSecret()

  if (!secret) {
    // Not a 401: that would confirm the endpoint exists and is merely guarded.
    // There is no scheduler to serve, so the route reports as absent.
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  return runScheduledTasks()
}

export async function POST(request: Request) {
  return GET(request)
}

/**
 * Seeds definitions, frees abandoned runs, then runs whatever is outstanding.
 *
 * Exported so the admin "run now" action and the tests can drive the same
 * sequence, rather than re-implementing the ordering.
 */
export async function runScheduledTasks(now = new Date()) {
  await seedDefinitions()

  // Before anything runs: an instance killed mid-task leaves its lock set, and
  // without this the whole tick would no-op until the staleness window passed.
  const recovered = await recoverStaleRuns(db)

  const registry = installTaskRegistry()
  const definitions = sortBySeedOrder(await listTaskDefinitions(db))
  const results: Record<string, string> = {}
  const periods: Record<string, string> = {}

  for (const definition of definitions) {
    // A disabled task is not work at all, so it is filtered here rather than
    // counted as a skip. `runTask` enforces the flag too, but by then the run
    // has already been reported as attempted, which makes a disabled task look
    // like a task that keeps being tried and declines.
    if (!definition.isEnabled) continue

    // The periods this task is owed, oldest first. Derived from the clock and
    // the definition alone, so a task with an empty history is due rather than
    // invisible: a fresh deployment backfills instead of waiting for the next
    // 1st of the month. One period per task per wake-up, so the deepest task
    // needs two wake-ups to settle.
    const targets = periodTargets(definition, now)
    if (targets.length === 0) continue

    if (UNIMPLEMENTED_TASKS.has(definition.name)) {
      // Named rather than raised: this is a known gap in the migration, and it
      // should read as one in the run summary rather than as a broken task.
      results[definition.name] = "unimplemented"
      continue
    }

    if (!registry.has(definition.name)) {
      results[definition.name] = "no implementation"
      continue
    }

    // Oldest period first. A week whose report never ran is finished before the
    // current one starts, and a task never skips a period in favour of a newer
    // one — which is what a single wake-up has to be for, since it can only
    // offer this once.
    const outstanding = await selectPeriod(targets, (target) =>
      getPeriodRunState(db, definition.id, target.start)
    )

    if (outstanding.kind === "done") {
      results[definition.name] = "already ran this period"
      continue
    }

    if (outstanding.kind === "exhausted") {
      // Said plainly rather than left to look like success: a task that has
      // failed every attempt in a period is waiting for the next one, not
      // quietly done with this one.
      results[definition.name] =
        `gave up after ${MAX_ATTEMPTS_PER_PERIOD} attempts`
      continue
    }

    const logger = createBufferingLogger()
    let outcome: RunOutcome

    try {
      outcome = await runTask(db, definition, { logger })
    } catch (error) {
      // runTask records its own failures; this catches only the setup around
      // it, so a database-level problem does not end the whole tick.
      results[definition.name] = `error: ${describe(error)}`
      continue
    }

    results[definition.name] = outcome.status
    periods[definition.name] = outstanding.target.key
  }

  return NextResponse.json({
    now: now.toISOString(),
    recovered,
    registered: [...getTaskRegistry().keys()],
    results,
    periods,
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
