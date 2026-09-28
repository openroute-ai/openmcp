/**
 * The single Cron entrypoint.
 *
 * Vercel Cron invokes one path on one schedule, so every task's own schedule
 * is evaluated here rather than in `vercel.json`. A task whose expression does
 * not match this moment is not started at all, which matters on the
 * serverless plan where the hourly invocation itself is metered.
 *
 * The endpoint fails closed. With no `CRON_SECRET` it returns 404 rather than
 * running anything, because a scheduler that writes to the database and pushes
 * webhooks must never degrade into an open trigger.
 *
 * Runs are sequential, not parallel. Several of these tasks read what the
 * previous one wrote — repository data feeds the rankings, the rankings feed
 * the notifications — and a serverless function that fired them all at once
 * would notify on half-written input. Each task also takes its own database
 * lock, so a second instance arriving mid-tick does not duplicate work.
 */

import { timingSafeEqual } from "node:crypto"
import { db } from "@/db/client"
import { cronSecret } from "@/lib/env"
import { isDue, TASK_SEEDS } from "@/lib/tasks/definitions"
import { installTaskRegistry, UNIMPLEMENTED_TASKS } from "@/lib/tasks/registry"
import {
  ensureTaskDefinition,
  hasRunDuringMinute,
  listTaskDefinitions,
} from "@/lib/github/service/task"
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

/**
 * Constant-time comparison of the bearer token.
 *
 * A plain `===` on a secret is a timing oracle, and this endpoint is
 * unauthenticated by default. Length is compared first because
 * `timingSafeEqual` throws on a length mismatch, and the length of a secret is
 * not itself the secret.
 */
function authorized(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`

  const given = Buffer.from(header)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false

  return timingSafeEqual(given, wanted)
}

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
 * The start of the minute `now` falls in, in UTC.
 *
 * Truncated to the minute rather than the hour, so a task scheduled for
 * 02:30 is only deduplicated against other 02:30 runs.
 */
function minuteStart(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes()
    )
  )
}

/**
 * Seeds definitions, frees abandoned runs, then runs whatever is due.
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
  const definitions = await listTaskDefinitions(db)
  const results: Record<string, string> = {}

  for (const definition of definitions) {
    // A disabled task is not work at all, so it is filtered here rather than
    // counted as a skip. `runTask` enforces the flag too, but by then the run
    // has already been reported as attempted, which makes a disabled task look
    // like a task that keeps being tried and declines.
    if (!definition.isEnabled) continue
    if (!isDue(definition, now)) continue

    if (UNIMPLEMENTED_TASKS.has(definition.name)) {
      // Named rather than raised: this is a known gap in the migration, and it
      // should read as one in the run summary rather than as a broken task.
      // Checked before the same-minute guard below, because nothing ever runs
      // for these and a guard should not change how a known gap reads.
      results[definition.name] = "unimplemented"
      continue
    }

    if (!registry.has(definition.name)) {
      results[definition.name] = "no implementation"
      continue
    }

    // `isDue` matches the current minute, so a retried or manually triggered
    // tick inside the same minute sees the same due set. Running it again would
    // repeat a full sweep of the external APIs for the same minute of work, and
    // only a real run leaves an execution row, so this does not mask anything.
    if (await hasRunDuringMinute(db, definition.id, minuteStart(now))) {
      results[definition.name] = "already ran this minute"
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
  }

  return NextResponse.json({
    now: now.toISOString(),
    recovered,
    registered: [...getTaskRegistry().keys()],
    results,
  })
}

/**
 * Creates any missing task definition.
 *
 * Run on every tick rather than from a migration, so adding a task is a code
 * change rather than a coordinated deploy of a migration and a scheduler.
 *
 * Insert-only, deliberately. An existing definition is left exactly as stored,
 * which is what preserves an operator's schedule change and their enabled
 * flag: seeding on every tick through an upsert would revert both to whatever
 * the code shipped with, minutes after anyone edited them.
 */
export async function seedDefinitions() {
  for (const seed of TASK_SEEDS) {
    await ensureTaskDefinition(db, {
      name: seed.name,
      description: seed.description,
      cronExpression: seed.cronExpression,
      taskType: seed.taskType,
      isDaily: seed.isDaily,
      isWeekly: seed.isWeekly,
      isMonthly: seed.isMonthly,
    })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
