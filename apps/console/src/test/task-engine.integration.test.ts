/**
 * Integration tests for the task engine, including the cross-instance lock.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set.
 *
 * One suite with one pool shutdown: sibling integration describes each
 * calling `pool.end()` in `afterAll` left every later suite running against a
 * closed pool, which surfaced as tests silently skipping rather than failing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import { taskDefinitions, taskExecutions } from "@/db/schema"
import {
  acquireTaskLock,
  completeExecution,
  createExecution,
  failExecution,
  getExecution,
  getLatestExecution,
  getTaskDefinitionByName,
  hasRunDuringMinute,
  isTaskRunning,
  listExecutions,
  listLiveExecutions,
  listRunningTasks,
  reclaimStaleExecutions,
  releaseTaskLock,
  setTaskEnabled,
  upsertTaskDefinition,
} from "@/lib/github/service/task"
import {
  buildSchedulerView,
  createBufferingLogger,
  recoverStaleRuns,
  runTask,
  runTaskByName,
  setTaskRegistry,
} from "@/lib/tasks/runner"
import { SKIP_CODES } from "@/lib/trpc/error-codes"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

/**
 * Start of the minute containing `at`, in UTC.
 *
 * Mirrors the truncation the Cron endpoint does before asking
 * `hasRunDuringMinute`, so the tests state the same window the route uses.
 */
function minuteStart(at: Date): Date {
  return new Date(
    Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      at.getUTCHours(),
      at.getUTCMinutes()
    )
  )
}

async function seedTask(name: string, overrides = {}) {
  return upsertTaskDefinition(db, {
    name,
    description: `${name} description`,
    cronExpression: "0 2 * * *",
    taskType: "daily",
    ...overrides,
  })
}

/** Backdates a run so it looks abandoned or merely long-running. */
async function backdate(executionId: string, startedAt: Date) {
  await db
    .update(taskExecutions)
    .set({ status: "running", startedAt })
    .where(eq(taskExecutions.id, executionId))
}

describe.skipIf(!hasDatabase)("task engine (integration)", () => {
  beforeAll(async () => {
    await db.delete(taskDefinitions)
  })

  afterAll(async () => {
    setTaskRegistry(undefined)
    await pool.end()
  })

  describe("definitions", () => {
    it("creates a definition", async () => {
      const definition = await seedTask("daily-update")
      expect(definition.name).toBe("daily-update")
      expect(definition.isEnabled).toBe(true)
    })

    it("is idempotent when seeded twice", async () => {
      // Seeding runs on every boot, so a second pass must update rather than
      // pile up duplicate rows.
      const first = await seedTask("weekly-job")
      const second = await seedTask("weekly-job")
      expect(second.id).toBe(first.id)
    })

    it("does not clear schedule flags the seed omits", async () => {
      const definition = await seedTask("flagged", { isDaily: true })
      await upsertTaskDefinition(db, {
        name: "flagged",
        taskType: "daily",
        cronExpression: "0 2 * * *",
      })

      // A seed that does not mention the flag must leave an operator's setting
      // alone rather than resetting it.
      expect((await getTaskDefinitionByName(db, "flagged"))?.isDaily).toBe(
        definition.isDaily
      )
    })

    it("does overwrite a flag the seed does supply", async () => {
      await seedTask("cleared", { isDaily: true })
      await upsertTaskDefinition(db, {
        name: "cleared",
        taskType: "daily",
        isDaily: false,
      })

      expect((await getTaskDefinitionByName(db, "cleared"))?.isDaily).toBe(
        false
      )
    })

    it("toggles a task off and on", async () => {
      const definition = await seedTask("toggle")
      await setTaskEnabled(db, definition.id, false)
      expect((await getTaskDefinitionByName(db, "toggle"))?.isEnabled).toBe(
        false
      )

      await setTaskEnabled(db, definition.id, true)
      expect((await getTaskDefinitionByName(db, "toggle"))?.isEnabled).toBe(
        true
      )
    })
  })

  describe("run lock", () => {
    it("grants the lock to the first caller", async () => {
      const definition = await seedTask("lock-a")
      const at = new Date()

      expect(await acquireTaskLock(db, definition.id, "exec-1", at)).toBe(true)
      expect(await isTaskRunning(db, definition.id)).toBe(true)
    })

    it("refuses a second holder while the first is running", async () => {
      // This is the guarantee the source's in-memory Map could not give: two
      // Vercel instances both see an empty map and both start.
      const definition = await seedTask("lock-b")
      const at = new Date()

      expect(await acquireTaskLock(db, definition.id, "exec-1", at)).toBe(true)
      expect(await acquireTaskLock(db, definition.id, "exec-2", at)).toBe(false)
    })

    it("grants exactly one lock under concurrent acquisition", async () => {
      const definition = await seedTask("lock-race")
      const at = new Date()

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          acquireTaskLock(db, definition.id, `exec-${index}`, at)
        )
      )

      // One winner, seven refusals: the conditional update is evaluated under
      // the row lock, so the contenders serialise rather than all winning.
      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it("grants the lock again once the first run releases it", async () => {
      const definition = await seedTask("lock-c")
      const at = new Date()

      await acquireTaskLock(db, definition.id, "exec-1", at)
      await releaseTaskLock(db, definition.id, "exec-1")

      expect(await acquireTaskLock(db, definition.id, "exec-2", at)).toBe(true)
    })

    it("does not let a stale run release its replacement's lock", async () => {
      const definition = await seedTask("lock-d")
      const at = new Date()

      await acquireTaskLock(db, definition.id, "exec-1", at)
      await releaseTaskLock(db, definition.id, "exec-1")
      await acquireTaskLock(db, definition.id, "exec-2", at)

      // The first run's finally block must not clear the second run's lock.
      await releaseTaskLock(db, definition.id, "exec-1")
      expect(await isTaskRunning(db, definition.id)).toBe(true)
    })

    it("reclaims a lock whose holder never released it", async () => {
      const definition = await seedTask("lock-stale")
      const longAgo = new Date(Date.now() - 60 * 60 * 1000)

      await acquireTaskLock(db, definition.id, "exec-dead", longAgo)

      // A run that died must not block its task forever; past the staleness
      // window the lock is taken over.
      expect(
        await acquireTaskLock(db, definition.id, "exec-new", new Date(), {
          staleAfter: new Date(Date.now() - 30 * 60 * 1000),
        })
      ).toBe(true)
    })

    it("keeps a healthy long-running lock", async () => {
      const definition = await seedTask("lock-healthy")
      const recent = new Date(Date.now() - 60 * 1000)

      await acquireTaskLock(db, definition.id, "exec-live", recent)

      expect(
        await acquireTaskLock(db, definition.id, "exec-other", new Date(), {
          staleAfter: new Date(Date.now() - 30 * 60 * 1000),
        })
      ).toBe(false)
    })

    it("lists the running tasks", async () => {
      const definition = await seedTask("lock-listed")
      await acquireTaskLock(db, definition.id, "exec-x", new Date())

      expect(await listRunningTasks(db)).toContain(definition.id)
      await releaseTaskLock(db, definition.id, "exec-x")
    })
  })

  describe("executions", () => {
    it("records a completed run with its duration", async () => {
      const definition = await seedTask("exec-ok")
      const execution = await createExecution(db, definition.id)

      await completeExecution(db, execution.id, { result: { updated: 3 } })

      const stored = await getExecution(db, execution.id)
      expect(stored?.status).toBe("completed")
      expect(stored?.result).toEqual({ updated: 3 })
      expect(stored?.duration).toBeGreaterThanOrEqual(0)
      expect(stored?.error).toBeNull()
    })

    it("records a failure with the message", async () => {
      const definition = await seedTask("exec-fail")
      const execution = await createExecution(db, definition.id)

      await failExecution(db, execution.id, new Error("registry timed out"))

      const stored = await getExecution(db, execution.id)
      expect(stored?.status).toBe("failed")
      expect(stored?.error).toContain("registry timed out")
    })

    it("records a non-Error failure", async () => {
      const definition = await seedTask("exec-throw-string")
      const execution = await createExecution(db, definition.id)

      await failExecution(db, execution.id, "just a string")

      expect((await getExecution(db, execution.id))?.error).toBe(
        "just a string"
      )
    })

    it("lists a task's executions newest first", async () => {
      const definition = await seedTask("exec-order")
      const first = await createExecution(db, definition.id)
      const second = await createExecution(db, definition.id)

      const listed = await listExecutions(db, definition.id)
      expect(listed[0]?.id).toBe(second.id)
      expect(listed[1]?.id).toBe(first.id)
    })

    it("filters executions by status", async () => {
      const definition = await seedTask("exec-filter")
      const failed = await createExecution(db, definition.id)
      await failExecution(db, failed.id, new Error("nope"))
      await createExecution(db, definition.id)

      const failedOnly = await listExecutions(db, definition.id, {
        status: "failed",
      })
      expect(failedOnly.map((e) => e.id)).toEqual([failed.id])
    })

    it("reports the latest execution", async () => {
      const definition = await seedTask("exec-latest")
      await createExecution(db, definition.id)
      const last = await createExecution(db, definition.id)

      expect((await getLatestExecution(db, definition.id))?.id).toBe(last.id)
    })

    it("counts only pending and running as live", async () => {
      const definition = await seedTask("exec-live")
      const done = await createExecution(db, definition.id)
      await completeExecution(db, done.id)
      await createExecution(db, definition.id)

      const live = await listLiveExecutions(db)
      expect(live.some((e) => e.id === done.id)).toBe(false)
    })

    it("spots a run that already happened inside the minute", async () => {
      const definition = await seedTask("exec-same-minute")
      // `createExecution` stamps `createdAt` from the clock, so the window has
      // to be derived from now rather than a fixed date: a fixed past date
      // would make the duration overflow and prove nothing about the guard.
      const now = new Date()

      expect(
        await hasRunDuringMinute(db, definition.id, minuteStart(now))
      ).toBe(false)

      const execution = await createExecution(db, definition.id)
      await completeExecution(db, execution.id)

      // The point of the guard: the Cron endpoint is woken twice for the same
      // minute, and repeating a full API sweep for it wastes the budget.
      expect(
        await hasRunDuringMinute(db, definition.id, minuteStart(now))
      ).toBe(true)
    })

    it("does not treat a failed run as done for the minute", async () => {
      // A transient API failure has to be retried, so the next tick within the
      // same minute should still see the task as work left to do.
      const definition = await seedTask("exec-retry-minute")
      const now = new Date()
      const execution = await createExecution(db, definition.id)
      await failExecution(db, execution.id, new Error("upstream 502"))

      expect(
        await hasRunDuringMinute(db, definition.id, minuteStart(now))
      ).toBe(false)
    })

    it("scopes the guard to one minute, not the whole hour", async () => {
      const definition = await seedTask("exec-minute-scope")
      const execution = await createExecution(db, definition.id)
      await completeExecution(db, execution.id)

      // Backdate the run so the window can be placed on either side of it.
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
      await db
        .update(taskExecutions)
        .set({ createdAt: tenMinutesAgo })
        .where(eq(taskExecutions.id, execution.id))

      // A task scheduled for 02:30 must not be suppressed by a 02:00 run, so
      // the window is a minute rather than anything coarser.
      expect(
        await hasRunDuringMinute(
          db,
          definition.id,
          minuteStart(new Date("2999-01-01T00:00:00Z"))
        )
      ).toBe(false)
      // A window that contains the run still finds it.
      expect(
        await hasRunDuringMinute(
          db,
          definition.id,
          minuteStart(new Date(tenMinutesAgo.getTime() - 60 * 1000))
        )
      ).toBe(true)
    })

    it("reclaims an abandoned run and frees its lock", async () => {
      const definition = await seedTask("exec-abandoned")
      const execution = await createExecution(db, definition.id)
      await acquireTaskLock(db, definition.id, execution.id, new Date())
      await backdate(execution.id, new Date(Date.now() - 7200_000))

      expect(await recoverStaleRuns(db, 60 * 60 * 1000)).toBe(1)
      expect((await getExecution(db, execution.id))?.status).toBe("failed")
      expect(await isTaskRunning(db, definition.id)).toBe(false)
    })

    it("leaves a healthy long run alone", async () => {
      const definition = await seedTask("exec-healthy")
      const execution = await createExecution(db, definition.id)
      await backdate(execution.id, new Date(Date.now() - 60_000))

      expect(await reclaimStaleExecutions(db, 60 * 60 * 1000)).toHaveLength(0)
      expect((await getExecution(db, execution.id))?.status).toBe("running")
    })

    it("cascades executions away with their definition", async () => {
      const definition = await seedTask("exec-cascade")
      const execution = await createExecution(db, definition.id)

      await db
        .delete(taskDefinitions)
        .where(eq(taskDefinitions.id, definition.id))
      expect(await getExecution(db, execution.id)).toBeUndefined()
    })
  })

  describe("runTask", () => {
    it("runs a task and records the result", async () => {
      setTaskRegistry(
        new Map([
          [
            "runner-ok",
            { name: "runner-ok", run: async () => ({ processed: 7 }) },
          ],
        ])
      )
      const definition = await seedTask("runner-ok")

      const outcome = await runTask(db, definition)
      if (outcome.status !== "completed") {
        throw new Error(`expected completion, got ${outcome.status}`)
      }

      expect(outcome.result).toEqual({ processed: 7 })
      expect(outcome.execution.status).toBe("completed")
      // The lock is released on the way out, so the next tick is not blocked.
      expect(await isTaskRunning(db, definition.id)).toBe(false)
    })

    it("skips a disabled task", async () => {
      setTaskRegistry(
        new Map([
          [
            "runner-disabled",
            { name: "runner-disabled", run: async () => ({}) },
          ],
        ])
      )
      const created = await seedTask("runner-disabled")
      await setTaskEnabled(db, created.id, false)

      // Re-read, because the enable flag changed after the row was returned
      // and runTask is handed a definition object rather than a name.
      const definition = await getTaskDefinitionByName(db, "runner-disabled")
      expect(definition).toBeDefined()
      expect((await runTask(db, definition!)).status).toBe("skipped")
    })

    it("skips a task that is already running", async () => {
      setTaskRegistry(
        new Map([
          ["runner-locked", { name: "runner-locked", run: async () => ({}) }],
        ])
      )
      const definition = await seedTask("runner-locked")
      await acquireTaskLock(db, definition.id, "exec-other", new Date())

      const outcome = await runTask(db, definition)
      expect(outcome.status).toBe("skipped")
      if (outcome.status === "skipped") {
        // The prose is what a log or a webhook response shows; the code is
        // what an interface translates, so both are part of the contract.
        expect(outcome.reason).toContain("already running")
        expect(outcome.reasonCode).toBe(SKIP_CODES.taskAlreadyRunning)
      }

      // A lost race must not leave a pending row, which would later be
      // reclaimed as an abandoned run.
      const live = await listLiveExecutions(db)
      expect(
        live.filter((row) => row.taskDefinitionId === definition.id)
      ).toHaveLength(0)
      const attempts = await listExecutions(db, definition.id)
      expect(attempts).toHaveLength(1)
      expect(attempts[0]?.status).toBe("cancelled")
    })

    it("records a throw and still releases the lock", async () => {
      setTaskRegistry(
        new Map([
          [
            "runner-throws",
            {
              name: "runner-throws",
              run: async () => {
                throw new Error("upstream 500")
              },
            },
          ],
        ])
      )
      const definition = await seedTask("runner-throws")

      const outcome = await runTask(db, definition)
      expect(outcome.status).toBe("failed")
      if (outcome.status === "failed") {
        expect(outcome.error).toContain("upstream 500")
      }
      // A failing task must not wedge its own schedule.
      expect(await isTaskRunning(db, definition.id)).toBe(false)
    })

    it("fails clearly when no implementation is registered", async () => {
      setTaskRegistry(new Map())
      const definition = await seedTask("runner-missing")

      const outcome = await runTask(db, definition)
      expect(outcome.status).toBe("failed")
      if (outcome.status === "failed") {
        expect(outcome.error).toContain("No task implementation")
      }
    })

    it("runs a task by name", async () => {
      setTaskRegistry(
        new Map([
          [
            "runner-by-name",
            { name: "runner-by-name", run: async () => ({ ok: 1 }) },
          ],
        ])
      )
      await seedTask("runner-by-name")

      expect((await runTaskByName(db, "runner-by-name")).status).toBe(
        "completed"
      )
    })

    it("skips an unknown task name", async () => {
      expect((await runTaskByName(db, "does-not-exist")).status).toBe("skipped")
    })

    it("persists the buffered log for a completed run", async () => {
      setTaskRegistry(
        new Map([
          [
            "runner-logs",
            {
              name: "runner-logs",
              run: async ({ logger }) => {
                logger.info("processed one repository")
                return {}
              },
            },
          ],
        ])
      )
      const definition = await seedTask("runner-logs")

      await runTask(db, definition, { logger: createBufferingLogger() })

      const [execution] = await listExecutions(db, definition.id)
      expect(execution?.logs).toContain("processed one repository")
    })

    it("builds a scheduler view counting recent failures", async () => {
      setTaskRegistry(new Map())
      const definition = await seedTask("runner-view")
      const failed = await createExecution(db, definition.id)
      await failExecution(db, failed.id, new Error("once"))
      await createExecution(db, definition.id)
      const succeeded = await createExecution(db, definition.id)
      await completeExecution(db, succeeded.id)

      const [entry] = await buildSchedulerView(db, [definition])
      // The most recent run succeeded, so the task must not read as failing.
      expect(entry?.recentFailures).toBe(1)
      expect(entry?.lastExecution?.status).toBe("completed")
      expect(entry?.isRunning).toBe(false)
    })
  })
})
