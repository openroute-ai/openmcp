/**
 * The inbound trigger webhook: run one named task now.
 *
 * Vercel Cron keeps the console's own schedule, but a deployment that wants an
 * external scheduler in charge - a separate cron service, a workflow runner -
 * needs a path that starts a named task on demand. This is that path:
 *
 *   POST /api/webhook/{task}   Authorization: Bearer <CRON_SECRET>
 *
 * The task still runs under the same database lock, staleness recovery and
 * execution row as a scheduled run, and respects the same same-minute guard, so
 * an external scheduler overlapping Vercel Cron does not double a full sweep of
 * the external APIs.
 *
 * Like the Cron entrypoint, this fails closed: with no `CRON_SECRET` it
 * reports as absent, because an endpoint that writes to the database and
 * pushes webhooks must never degrade into an open trigger.
 */

import { db } from "@/db/client"
import { cronSecret } from "@/lib/env"
import { authorized } from "@/lib/cron/guard"
import { installTaskRegistry, UNIMPLEMENTED_TASKS } from "@/lib/tasks/registry"
import { seedDefinitions } from "@/lib/tasks/seed"
import {
  getTaskDefinitionByName,
  hasRunDuringMinute,
} from "@/lib/github/service/task"
import {
  createBufferingLogger,
  recoverStaleRuns,
  runTask,
  type RunOutcome,
} from "@/lib/tasks/runner"
import { NextResponse } from "next/server"
import { SKIP_CODES } from "@/lib/trpc/error-codes"

/** A long-running task can spend minutes on a large catalogue, like cron's. */
export const maxDuration = 300

/** Not cached: every invocation must do work. */
export const dynamic = "force-dynamic"

/**
 * The start of the minute `now` falls in, in UTC.
 *
 * Matches the Cron entrypoint's guard, so a webhook-triggered run and a
 * scheduled run landing in the same minute see each other.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ task: string }> }
) {
  const secret = cronSecret()

  if (!secret) {
    // Not a 401: that would confirm the endpoint exists and is merely guarded.
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { task } = await params
  return triggerTask(task)
}

/**
 * Seeds definitions, then runs the named task once.
 *
 * Exported so tests drive the same sequence, and the sequence is the same one
 * `runScheduledTasks` uses: definitions first, stale locks freed before
 * anything runs, and a task that is known-missing reported as such rather than
 * attempted.
 */
export async function triggerTask(name: string) {
  await seedDefinitions()

  const definition = await getTaskDefinitionByName(db, name)
  if (!definition) {
    return NextResponse.json(
      { error: `unknown task: ${name}` },
      { status: 404 }
    )
  }

  if (UNIMPLEMENTED_TASKS.has(definition.name)) {
    return NextResponse.json(
      { task: name, status: "unimplemented" },
      { status: 501 }
    )
  }

  const registry = installTaskRegistry()
  if (!registry.has(definition.name)) {
    return NextResponse.json(
      { task: name, status: "no implementation" },
      { status: 404 }
    )
  }

  if (!definition.isEnabled) {
    return NextResponse.json(
      {
        task: name,
        status: "skipped",
        reason: "task is disabled",
        reasonCode: SKIP_CODES.taskDisabled,
      },
      { status: 409 }
    )
  }

  if (await hasRunDuringMinute(db, definition.id, minuteStart(new Date()))) {
    return NextResponse.json(
      {
        task: name,
        status: "skipped",
        reason: "already ran this minute",
        reasonCode: SKIP_CODES.alreadyRanThisMinute,
      },
      { status: 409 }
    )
  }

  // An instance killed mid-task leaves its lock set; free it before running so
  // this trigger is not silently ignored by a dead predecessor.
  await recoverStaleRuns(db)

  const logger = createBufferingLogger()
  const outcome: RunOutcome = await runTask(db, definition, {
    logger,
    triggeredBy: "manual",
  })

  if (outcome.status === "completed") {
    return NextResponse.json({
      task: name,
      status: outcome.status,
      result: outcome.result,
    })
  }

  if (outcome.status === "failed") {
    return NextResponse.json(
      { task: name, status: outcome.status, error: outcome.error },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      task: name,
      status: outcome.status,
      reason: outcome.reason,
      reasonCode: outcome.reasonCode ?? null,
    },
    { status: 409 }
  )
}
