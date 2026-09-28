/**
 * Task execution.
 *
 * A run is: take the lock, create an execution row, do the work, record the
 * outcome, release the lock. The lock and the execution row are separate
 * because they answer different questions — "is anything running now?" and
 * "what happened last time?" — and the history must survive the lock.
 */

import {
  acquireTaskLock,
  cancelExecution,
  completeExecution,
  createExecution,
  failExecution,
  getExecution,
  getTaskDefinitionByName,
  isTaskRunning,
  listExecutions,
  getLatestExecution,
  markExecutionRunning,
  reclaimStaleExecutions,
  releaseLocksForExecutions,
  releaseTaskLock,
  type TaskDefinitionRow,
  type TaskExecutionRow,
} from "@/lib/github/service/task"
import type { Db } from "@/lib/github/service/repo"

export interface TaskContext {
  db: Db
  definition: TaskDefinitionRow
  execution: TaskExecutionRow
  logger: TaskLogger
}

export interface TaskLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface Task {
  name: string
  description?: string
  run(context: TaskContext): Promise<Record<string, unknown> | void>
}

/** A run that has been going longer than this is assumed dead. */
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000

export function createBufferingLogger(
  limit = 20_000
): TaskLogger & { text(): string } {
  const lines: string[] = []
  let length = 0

  const push = (level: string, message: string, args: unknown[]) => {
    const rendered = args.length > 0 ? ` ${args.map(stringifyArg).join(" ")}` : ""
    const line = `${new Date().toISOString()} ${level} ${message}${rendered}`

    // The oldest lines are dropped first, so a chatty run keeps its recent
    // context rather than the first thing it did.
    if (length + line.length > limit) {
      const removed = lines.shift()
      if (removed) length -= removed.length
    }
    lines.push(line)
    length += line.length
  }

  return {
    info: (message, ...args) => {
      push("INFO", message, args)
      console.info(`[task] ${message}`, ...args)
    },
    warn: (message, ...args) => {
      push("WARN", message, args)
      console.warn(`[task] ${message}`, ...args)
    },
    error: (message, ...args) => {
      push("ERROR", message, args)
      console.error(`[task] ${message}`, ...args)
    },
    text: () => lines.join("\n"),
  }
}

/** Log text, or undefined when the logger does not buffer. */
function collectLogs(logger: TaskLogger): string | undefined {
  const buffered = logger as TaskLogger & { text?: () => string }
  return typeof buffered.text === "function" ? buffered.text() : undefined
}

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // A circular object must not turn a run into an unloggable one.
    return String(value)
  }
}

export type RunOutcome =
  | { status: "completed"; execution: TaskExecutionRow; result: unknown }
  | { status: "skipped"; reason: string }
  | { status: "failed"; execution: TaskExecutionRow; error: string }

export interface RunOptions {
  triggeredBy?: "system" | "manual"
  staleAfterMs?: number
  logger?: TaskLogger
  /** Bypasses the lock, for an operator asking twice on purpose. */
  force?: boolean
}

/**
 * Runs a task under its database lock.
 *
 * `skipped` is returned rather than thrown when the task is disabled or
 * already running: a Cron tick overlapping the previous one is normal, and
 * reporting it as a failure would make the schedule look broken.
 *
 * The lock is released in a `finally`, after the failure has been recorded,
 * so a task that throws still leaves an accurate execution row and does not
 * wedge its own schedule.
 */
export async function runTask(
  db: Db,
  definition: TaskDefinitionRow,
  options: RunOptions = {}
): Promise<RunOutcome> {
  if (!definition.isEnabled && !options.force) {
    return { status: "skipped", reason: "task is disabled" }
  }

  const startedAt = new Date()
  const execution = await createExecution(
    db,
    definition.id,
    options.triggeredBy ?? "system"
  )

  if (!options.force) {
    const acquired = await acquireTaskLock(
      db,
      definition.id,
      execution.id,
      startedAt,
      // A lock last touched before the cutoff belongs to a run that is
      // presumed dead, so it can be taken over.
      {
        staleAfter: new Date(
          startedAt.getTime() -
            (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)
        ),
      }
    )

    if (!acquired) {
      // The execution row is created before the lock is taken, because the
      // lock records the holder's execution id. A run that loses the race
      // never started, so it is cancelled rather than left pending: a pending
      // row counts as live and would later be reclaimed as an abandoned run,
      // reporting a healthy overlapping tick as a failure.
      await cancelExecution(db, execution.id)
      return { status: "skipped", reason: "task is already running" }
    }
  }

  const logger = options.logger ?? createBufferingLogger()

  try {
    await markExecutionRunning(db, execution.id, startedAt)
    const result = await resolveTask(definition.name).run({
      db,
      definition,
      execution,
      logger,
    })
    // Read after the run, so the logs include what happened during it.
    const logs = collectLogs(logger)

    await completeExecution(db, execution.id, {
      result: (result ?? {}) as Record<string, unknown>,
      logs,
    })

    const finished = (await getExecution(db, execution.id)) ?? execution
    return { status: "completed", execution: finished, result }
  } catch (error) {
    logger.error("task failed", error)
    await failExecution(db, execution.id, error, { logs: collectLogs(logger) })

    const finished = (await getExecution(db, execution.id)) ?? execution
    return {
      status: "failed",
      execution: finished,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (!options.force) {
      // Guarded on the execution id inside the service, so a run that was
      // replaced cannot clear its replacement's lock.
      await releaseTaskLock(db, definition.id, execution.id)
    }
  }
}

/** Looks a task up by name and runs it. */
export async function runTaskByName(
  db: Db,
  name: string,
  options: RunOptions = {}
): Promise<RunOutcome> {
  const definition = await getTaskDefinitionByName(db, name)
  if (!definition) {
    return { status: "skipped", reason: `no task named ${name}` }
  }
  return runTask(db, definition, options)
}

let registry: Map<string, Task> | undefined

/**
 * The registered task implementations.
 *
 * The registry is injected rather than imported so this module stays free of
 * the GitHub client, which requires a token at construction. The status page
 * reads task history through this file and must not need a token to do it.
 */
/** Pass undefined to clear the registry, as tests do between cases. */
export function setTaskRegistry(tasks: Map<string, Task> | undefined): void {
  registry = tasks
}

export function getTaskRegistry(): Map<string, Task> {
  return registry ?? new Map()
}

function resolveTask(name: string): Task {
  const task = getTaskRegistry().get(name)
  if (!task) {
    throw new Error(`No task implementation registered for ${name}`)
  }
  return task
}

export interface SchedulerEntry {
  name: string
  cronExpression: string | null
  isEnabled: boolean
  isRunning: boolean
  lastRunAt: Date | null
  lastExecution: TaskExecutionRow | undefined
  recentFailures: number
}

/**
 * A per-task view for the status page.
 *
 * `recentFailures` counts the recent window rather than reading the last
 * execution's status, so a task that failed twice and then succeeded is not
 * still reported as failing.
 */
export async function buildSchedulerView(
  db: Db,
  definitions: TaskDefinitionRow[]
): Promise<SchedulerEntry[]> {
  return Promise.all(
    definitions.map(async (definition) => {
      const [latest, executions, running] = await Promise.all([
        getLatestExecution(db, definition.id),
        listExecutions(db, definition.id, { limit: 10 }),
        isTaskRunning(db, definition.id),
      ])

      return {
        name: definition.name,
        cronExpression: definition.cronExpression,
        isEnabled: definition.isEnabled,
        isRunning: running,
        lastRunAt: latest?.startedAt ?? null,
        lastExecution: latest,
        recentFailures: executions.filter((e) => e.status === "failed").length,
      }
    })
  )
}

/**
 * Frees runs abandoned by a dead process and reports how many were released.
 *
 * Called at the start of a Cron tick. A task whose instance was killed
 * mid-run would otherwise stay locked until its own staleness window elapsed,
 * so the first tick after a crash would do nothing at all.
 */
export async function recoverStaleRuns(
  db: Db,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
): Promise<number> {
  const stale = await reclaimStaleExecutions(db, staleAfterMs)
  await releaseLocksForExecutions(db, stale)
  return stale.length
}
