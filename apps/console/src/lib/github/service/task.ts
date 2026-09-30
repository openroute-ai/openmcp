/**
 * Task definitions, executions, and the cross-instance run lock.
 *
 * The source app's scheduler guarded concurrent runs with an in-memory
 * `Map<string, Promise>`. On Vercel each request gets its own instance with
 * no shared memory, so that map only ever knew about the one run visible to
 * its own process: two Cron invocations a minute apart would both check an
 * empty map, both see the task as free, and both start. The lock here lives
 * in the database and is taken with a conditional update, so exactly one
 * caller can hold it.
 */

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  taskDefinitions,
  taskExecutions,
  taskStatus,
  type TaskStatus,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

export type TaskDefinitionRow = typeof taskDefinitions.$inferSelect
export type TaskExecutionRow = typeof taskExecutions.$inferSelect

export type { TaskStatus }

export interface TaskDefinitionInput {
  name: string
  description?: string | null
  /** Cron expression, interpreted in Asia/Shanghai. */
  cronExpression?: string | null
  isEnabled?: boolean
  isDaily?: boolean
  isWeekly?: boolean
  isMonthly?: boolean
  taskType: string
}

/**
 * Creates or updates a definition by name.
 *
 * Keyed on the name rather than the id, so a definition can be seeded
 * idempotently: a fresh deployment can run the same seed on every boot
 * without piling up duplicate rows.
 *
 * The schedule flags are only written when the incoming definition supplies
 * them. A seed that names a task but leaves it daily-only must not clear a
 * weekly flag an editor set.
 */
export async function upsertTaskDefinition(
  db: Db,
  input: TaskDefinitionInput
): Promise<TaskDefinitionRow> {
  const set: Partial<typeof taskDefinitions.$inferInsert> = {
    description: input.description,
    cronExpression: input.cronExpression,
    taskType: input.taskType,
    updatedAt: new Date(),
  }
  if (input.isEnabled !== undefined) set.isEnabled = input.isEnabled
  if (input.isDaily !== undefined) set.isDaily = input.isDaily
  if (input.isWeekly !== undefined) set.isWeekly = input.isWeekly
  if (input.isMonthly !== undefined) set.isMonthly = input.isMonthly

  const [row] = await db
    .insert(taskDefinitions)
    .values({
      id: nanoid(),
      name: input.name,
      description: input.description ?? null,
      cronExpression: input.cronExpression ?? null,
      isEnabled: input.isEnabled ?? true,
      isDaily: input.isDaily ?? false,
      isWeekly: input.isWeekly ?? false,
      isMonthly: input.isMonthly ?? false,
      taskType: input.taskType,
    })
    .onConflictDoUpdate({ target: taskDefinitions.name, set })
    .returning()

  if (!row) throw new Error(`Failed to upsert task definition ${input.name}`)
  return row
}

/**
 * Creates a definition only if the name is not already taken.
 *
 * The counterpart to {@link upsertTaskDefinition}, for the scheduler's own
 * seeding. `onConflictDoNothing` means an existing row is left exactly as it
 * is, so re-running the seed every Cron tick does not revert a schedule an
 * operator changed - which an upsert would, since the seed still carries the
 * value the code shipped with.
 */
export async function ensureTaskDefinition(
  db: Db,
  input: TaskDefinitionInput
): Promise<TaskDefinitionRow> {
  const [row] = await db
    .insert(taskDefinitions)
    .values({
      id: nanoid(),
      name: input.name,
      description: input.description ?? null,
      cronExpression: input.cronExpression ?? null,
      isEnabled: input.isEnabled ?? true,
      isDaily: input.isDaily ?? false,
      isWeekly: input.isWeekly ?? false,
      isMonthly: input.isMonthly ?? false,
      taskType: input.taskType,
    })
    .onConflictDoNothing({ target: taskDefinitions.name })
    .returning()

  // No row means the name already existed, so the stored one is the truth.
  if (row) return row

  const existing = await getTaskDefinitionByName(db, input.name)
  if (!existing) {
    throw new Error(`Failed to seed task definition ${input.name}`)
  }
  return existing
}

export async function getTaskDefinitionByName(
  db: Db,
  name: string
): Promise<TaskDefinitionRow | undefined> {
  return db.query.taskDefinitions.findFirst({
    where: eq(taskDefinitions.name, name),
  })
}

export async function getTaskDefinition(
  db: Db,
  id: string
): Promise<TaskDefinitionRow | undefined> {
  return db.query.taskDefinitions.findFirst({
    where: eq(taskDefinitions.id, id),
  })
}

export async function listTaskDefinitions(
  db: Db,
  options: { onlyEnabled?: boolean } = {}
): Promise<TaskDefinitionRow[]> {
  return db
    .select()
    .from(taskDefinitions)
    .where(
      options.onlyEnabled ? eq(taskDefinitions.isEnabled, true) : undefined
    )
    .orderBy(taskDefinitions.name)
}

export async function setTaskEnabled(
  db: Db,
  id: string,
  enabled: boolean
): Promise<void> {
  await db
    .update(taskDefinitions)
    .set({ isEnabled: enabled, updatedAt: new Date() })
    .where(eq(taskDefinitions.id, id))
}

// --- the run lock ---------------------------------------------------------

/**
 * Attempts to take the run lock for a task.
 *
 * The insert carries `is_running: true`, and the conflict branch only
 * succeeds while the existing row is not running. PostgreSQL evaluates that
 * predicate under the row lock, so of two concurrent callers exactly one
 * insert wins and the other updates zero rows. That is the whole point: the
 * source's check-then-set on an in-memory map had no equivalent guarantee,
 * and even a database read-then-write would race the same way.
 *
 * A task with no status row yet is claimed by the insert, so no separate
 * "create the row" step can be raced.
 *
 * A lock whose holder died is reclaimed once `staleAfter` has passed: the
 * row records who holds it, and a run that has been marked running for longer
 * than the maximum expected runtime is assumed abandoned rather than left to
 * block the task forever.
 */
export async function acquireTaskLock(
  db: Db,
  taskDefinitionId: string,
  executionId: string,
  startedAt: Date,
  options: { staleAfter?: Date } = {}
): Promise<boolean> {
  const staleAfter = options.staleAfter

  const inserted = await db
    .insert(taskStatus)
    .values({
      taskDefinitionId,
      isRunning: true,
      lastRunAt: startedAt,
      lastExecutionId: executionId,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ taskDefinitionId: taskStatus.taskDefinitionId })

  if (inserted.length > 0) return true

  // The row exists, so the lock is contended. Reclaim it only if the current
  // holder is not running, or has been running since before the cutoff.
  const updated = await db
    .update(taskStatus)
    .set({
      isRunning: true,
      lastRunAt: startedAt,
      lastExecutionId: executionId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taskStatus.taskDefinitionId, taskDefinitionId),
        staleAfter
          ? or(
              eq(taskStatus.isRunning, false),
              and(
                eq(taskStatus.isRunning, true),
                lt(taskStatus.lastRunAt, staleAfter)
              )
            )
          : eq(taskStatus.isRunning, false)
      )
    )
    .returning({ taskDefinitionId: taskStatus.taskDefinitionId })

  return updated.length > 0
}

/** Releases the lock, but only for the run that holds it. */
export async function releaseTaskLock(
  db: Db,
  taskDefinitionId: string,
  executionId: string
): Promise<void> {
  await db
    .update(taskStatus)
    .set({ isRunning: false, updatedAt: new Date() })
    .where(
      and(
        eq(taskStatus.taskDefinitionId, taskDefinitionId),
        // Guarding on the holder means a run that timed out and was replaced
        // cannot clear the replacement's lock on its way out.
        eq(taskStatus.lastExecutionId, executionId)
      )
    )
}

export async function isTaskRunning(
  db: Db,
  taskDefinitionId: string
): Promise<boolean> {
  const row = await db.query.taskStatus.findFirst({
    where: eq(taskStatus.taskDefinitionId, taskDefinitionId),
  })
  return row?.isRunning === true
}

export async function listRunningTasks(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: taskStatus.taskDefinitionId })
    .from(taskStatus)
    .where(eq(taskStatus.isRunning, true))
  return rows.map((row) => row.id)
}

// --- executions ------------------------------------------------------------

export async function createExecution(
  db: Db,
  taskDefinitionId: string,
  triggeredBy: "system" | "manual" = "system"
): Promise<TaskExecutionRow> {
  const [row] = await db
    .insert(taskExecutions)
    .values({
      id: nanoid(),
      taskDefinitionId,
      status: "pending",
      triggeredBy,
    })
    .returning()

  if (!row) throw new Error("Failed to create task execution")
  return row
}

export async function markExecutionRunning(
  db: Db,
  executionId: string,
  startedAt: Date
): Promise<void> {
  await db
    .update(taskExecutions)
    .set({ status: "running", startedAt })
    .where(eq(taskExecutions.id, executionId))
}

/**
 * Milliseconds between a run starting and finishing.
 *
 * Measured from `startedAt` when the run recorded one, otherwise from
 * `createdAt`: a run that completes without ever being marked running still
 * took time, and recording no duration at all would make its timing
 * indistinguishable from a run whose duration was never computed.
 */
function elapsedMs(
  execution: Pick<TaskExecutionRow, "startedAt" | "createdAt"> | undefined,
  completedAt: Date
): number {
  if (!execution) return 0
  const from = execution.startedAt ?? execution.createdAt
  return Math.max(0, completedAt.getTime() - new Date(from).getTime())
}

export async function completeExecution(
  db: Db,
  executionId: string,
  options: {
    result?: Record<string, unknown>
    logs?: string
    completedAt?: Date
  } = {}
): Promise<void> {
  const completedAt = options.completedAt ?? new Date()
  const execution = await getExecution(db, executionId)

  await db
    .update(taskExecutions)
    .set({
      status: "completed",
      completedAt,
      duration: elapsedMs(execution, completedAt),
      result: options.result ?? null,
      error: null,
      ...(options.logs !== undefined ? { logs: options.logs } : {}),
    })
    .where(eq(taskExecutions.id, executionId))
}

export async function failExecution(
  db: Db,
  executionId: string,
  error: unknown,
  options: { logs?: string } = {}
): Promise<void> {
  const completedAt = new Date()
  const execution = await getExecution(db, executionId)

  await db
    .update(taskExecutions)
    .set({
      status: "failed",
      completedAt,
      duration: elapsedMs(execution, completedAt),
      // Truncated because a stack trace can exceed what a text column is
      // meant to hold once several runs accumulate.
      error: describeError(error).slice(0, 8000),
      ...(options.logs !== undefined ? { logs: options.logs } : {}),
    })
    .where(eq(taskExecutions.id, executionId))
}

export async function cancelExecution(
  db: Db,
  executionId: string
): Promise<void> {
  await db
    .update(taskExecutions)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(taskExecutions.id, executionId))
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

export async function getExecution(
  db: Db,
  executionId: string
): Promise<TaskExecutionRow | undefined> {
  return db.query.taskExecutions.findFirst({
    where: eq(taskExecutions.id, executionId),
  })
}

export async function listExecutions(
  db: Db,
  taskDefinitionId: string,
  options: { limit?: number; status?: TaskStatus } = {}
): Promise<TaskExecutionRow[]> {
  return db
    .select()
    .from(taskExecutions)
    .where(
      options.status
        ? and(
            eq(taskExecutions.taskDefinitionId, taskDefinitionId),
            eq(taskExecutions.status, options.status)
          )
        : eq(taskExecutions.taskDefinitionId, taskDefinitionId)
    )
    .orderBy(desc(taskExecutions.createdAt))
    .limit(Math.min(options.limit ?? 20, 100))
}

/** The most recent execution for a task, if any. */
export async function getLatestExecution(
  db: Db,
  taskDefinitionId: string
): Promise<TaskExecutionRow | undefined> {
  const [row] = await db
    .select()
    .from(taskExecutions)
    .where(eq(taskExecutions.taskDefinitionId, taskDefinitionId))
    .orderBy(desc(taskExecutions.createdAt))
    .limit(1)
  return row
}

export async function listLiveExecutions(db: Db): Promise<TaskExecutionRow[]> {
  return db
    .select()
    .from(taskExecutions)
    .where(inArray(taskExecutions.status, ["pending", "running"]))
    .orderBy(desc(taskExecutions.createdAt))
}

/**
 * Whether a task already ran, or at least started, inside `minute`.
 *
 * The Cron endpoint is woken by Vercel and can be woken twice: once on a
 * retry after a timeout, and once by whoever hits the URL to check it. Because
 * `isDue` matches the current minute rather than a window since the last tick,
 * a second call inside the same minute sees exactly the same set of due tasks.
 * The database lock only covers overlap while the first run is still going, so
 * without this check a retry that lands after the first run finished would
 * repeat a full GitHub re-batching sweep and spend the API budget twice for
 * the same minute of work.
 *
 * A failed run does not count: retrying a minute later is how a task recovers
 * from a transient API error, and treating the failure as done would make the
 * task wait a full day instead.
 */
export async function hasRunDuringMinute(
  db: Db,
  taskDefinitionId: string,
  minute: Date
): Promise<boolean> {
  const [row] = await db
    .select({ id: taskExecutions.id })
    .from(taskExecutions)
    .where(
      and(
        eq(taskExecutions.taskDefinitionId, taskDefinitionId),
        gte(taskExecutions.createdAt, minute),
        // A failure is not an attempt worth repeating: the next tick retries
        // it, which is how a transient API error clears without waiting a day.
        ne(taskExecutions.status, "failed")
      )
    )
    .limit(1)

  return row !== undefined
}

export interface PeriodRunState {
  /** A run inside the period completed. */
  completed: boolean
  /**
   * Runs the period has used, failures included.
   *
   * Cancelled runs are not counted: they never started, they lost the lock
   * race, and charging them against the retry budget would let an overlapping
   * tick spend a task's attempts.
   */
  attempts: number
}

/**
 * How much of one period a task has already done.
 *
 * The Cron tick is a cascade over periods rather than a fixed list of minutes,
 * so what has already happened is a question about the period, and the run
 * history is what answers it. `taskStatus.lastRunAt` cannot: it records when a
 * run was *claimed*, so a task that failed an hour ago reads as having run, and
 * the failed period would never be retried.
 *
 * Counted rather than read as a boolean because a period may be retried: the
 * attempt count is what stops a task that keeps failing from being retried on
 * every wake-up forever.
 */
export async function getPeriodRunState(
  db: Db,
  taskDefinitionId: string,
  since: Date
): Promise<PeriodRunState> {
  const rows = await db
    .select({
      status: taskExecutions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(taskExecutions)
    .where(
      and(
        eq(taskExecutions.taskDefinitionId, taskDefinitionId),
        gte(taskExecutions.createdAt, since),
        ne(taskExecutions.status, "cancelled")
      )
    )
    .groupBy(taskExecutions.status)

  let completed = false
  let attempts = 0

  for (const row of rows) {
    if (row.status === "completed") completed = true
    attempts += row.count
  }

  return { completed, attempts }
}

/**
 * Finds executions that were left `pending` or `running` by a process that
 * died, so a Vercel instance killed mid-task does not leave the task locked
 * forever.
 *
 * `staleAfterMs` is measured from when the run started, not from when the row
 * was written, so a long task is not reclaimed while it is still working.
 */
export async function reclaimStaleExecutions(
  db: Db,
  staleAfterMs: number
): Promise<TaskExecutionRow[]> {
  const rows = await db
    .select()
    .from(taskExecutions)
    .where(
      or(
        // Never started, so measured against creation.
        and(
          eq(taskExecutions.status, "pending"),
          lt(taskExecutions.createdAt, new Date(Date.now() - staleAfterMs))
        ),
        and(
          eq(taskExecutions.status, "running"),
          isNotNull(taskExecutions.startedAt),
          lt(taskExecutions.startedAt, new Date(Date.now() - staleAfterMs))
        )
      )
    )

  if (rows.length === 0) return []

  await db
    .update(taskExecutions)
    .set({
      status: "failed",
      completedAt: new Date(),
      error: "Abandoned: no completion recorded before the stale timeout",
    })
    .where(
      inArray(
        taskExecutions.id,
        rows.map((row) => row.id)
      )
    )

  return rows
}

/** Clears the run lock for a task whose execution was just reclaimed. */
export async function releaseLocksForExecutions(
  db: Db,
  executions: TaskExecutionRow[]
): Promise<void> {
  for (const execution of executions) {
    await releaseTaskLock(db, execution.taskDefinitionId, execution.id)
  }
}

export async function countExecutionsByStatus(
  db: Db
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: taskExecutions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(taskExecutions)
    .groupBy(taskExecutions.status)

  return Object.fromEntries(rows.map((row) => [row.status, row.count]))
}
