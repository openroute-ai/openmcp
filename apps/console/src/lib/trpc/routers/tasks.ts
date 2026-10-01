import { asc, count, desc, eq, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  TASK_STATUSES,
  taskDefinitions,
  taskExecutions,
  taskStatus,
} from "@/db/schema"
import { getTaskDefinitionByName } from "@/lib/github/service/task"
import { createBufferingLogger, runTask } from "@/lib/tasks/runner"
import { installTaskRegistry } from "@/lib/tasks/registry"
import { seedDefinitions } from "@/lib/tasks/seed"
import { nextRunAt, type PeriodState } from "@/lib/tasks/schedule"
import { createTRPCRouter, adminProcedure } from "../init"
import { ERROR_CODES, SKIP_CODES } from "@/lib/trpc/error-codes"

const statusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
])

const nameSchema = z.string().min(1)

/**
 * 历史表格在一页里放多少行。
 *
 * 比列表页的 20 宽，因为详情页没有旁边那张"全部任务"的表格要留位置；而比 500 窄，
 * 因为 500 行会变成一屏看不到头的滚动条，而这一页的重点是"最近发生了什么"，
 * 不是"把整个数据库导出"。完整历史仍在 `executions` 里可分页。
 */
const EXECUTION_HISTORY_LIMIT = 100

/**
 * The fields the "which run is the latest" and "did it already run" answers need.
 *
 * Exported only so the declaration emit can name it: the router's inferred output
 * type reaches it through `lastExecution`, and an unexported local would make
 * every consumer of `AppRouter` fail to typecheck with TS4023.
 */
export interface ExecutionProbe {
  id: string
  taskDefinitionId: string
  status: (typeof TASK_STATUSES)[number]
  startedAt: Date | null
  completedAt: Date | null
  duration: number | null
  createdAt: Date
  triggeredBy: string
  error: string | null
}

/**
 * The newest execution per task, from rows already ordered newest-first.
 *
 * Reduced in JS rather than with `DISTINCT ON`: the newest execution per task is
 * the first row seen for that task in the descending order, so a map keyed by
 * task keeps one row per task and a window function would only add a round trip
 * to compute the same thing.
 */
function pickLatestByTask(rows: ExecutionProbe[]) {
  const latest = new Map<string, ExecutionProbe>()
  for (const row of rows) {
    if (!latest.has(row.taskDefinitionId)) {
      latest.set(row.taskDefinitionId, row)
    }
  }
  return latest
}

/**
 * "Has this task already run in this period, and did it succeed?"
 *
 * Built from the same rows `pickLatestByTask` sees rather than from a second
 * query, so the "next run" a list row shows and the one a detail page shows are
 * computed from the same evidence and cannot disagree.
 *
 * A cancelled run is left out and a row without a timestamp cannot be placed, so
 * both are excluded rather than guessed at — a run that never started has no
 * period to belong to.
 */
function buildPeriodStates(
  rows: ExecutionProbe[],
  taskId: string
): (target: { start: Date }) => PeriodState {
  const runs: { at: number; completed: boolean }[] = []
  for (const row of rows) {
    if (row.taskDefinitionId !== taskId) continue
    if (row.status === "cancelled" || !row.createdAt) continue
    runs.push({
      at: new Date(row.createdAt).getTime(),
      completed: row.status === "completed",
    })
  }

  return (target: { start: Date }): PeriodState => {
    let completed = false
    let attempts = 0
    for (const run of runs) {
      if (run.at < target.start.getTime()) continue
      attempts += 1
      if (run.completed) completed = true
    }
    return { completed, attempts }
  }
}

export const tasksRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const [rows, latest] = await Promise.all([
      ctx.db
        .select({
          id: taskDefinitions.id,
          name: taskDefinitions.name,
          description: taskDefinitions.description,
          cronExpression: taskDefinitions.cronExpression,
          taskType: taskDefinitions.taskType,
          isEnabled: taskDefinitions.isEnabled,
          isRunning: taskStatus.isRunning,
          lastRunAt: taskStatus.lastRunAt,
        })
        .from(taskDefinitions)
        .leftJoin(
          taskStatus,
          eq(taskStatus.taskDefinitionId, taskDefinitions.id)
        )
        .orderBy(asc(taskDefinitions.name)),
      ctx.db
        .select({
          id: taskExecutions.id,
          taskDefinitionId: taskExecutions.taskDefinitionId,
          status: taskExecutions.status,
          startedAt: taskExecutions.startedAt,
          completedAt: taskExecutions.completedAt,
          createdAt: taskExecutions.createdAt,
          duration: taskExecutions.duration,
          triggeredBy: taskExecutions.triggeredBy,
          error: taskExecutions.error,
        })
        .from(taskExecutions)
        .orderBy(desc(taskExecutions.createdAt))
        .limit(500),
    ])

    const latestByTask = pickLatestByTask(latest)

    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        cronExpression: row.cronExpression,
        taskType: row.taskType,
        isEnabled: row.isEnabled,
        isRunning: row.isRunning ?? false,
        lastRunAt: row.lastRunAt,
        nextRunAt:
          (row.isEnabled
            ? await nextRunAt(
                {
                  name: row.name,
                  taskType: row.taskType,
                  cronExpression: row.cronExpression,
                },
                buildPeriodStates(latest, row.id),
                now
              )
            : undefined) ?? null,
        lastExecution: latestByTask.get(row.id) ?? null,
      }))
    )
  }),

  executions: adminProcedure
    .input(
      z.object({
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = input.status
        ? eq(taskExecutions.status, input.status)
        : undefined

      // The count shares the filter, so the page count cannot disagree with the
      // rows: both read the same predicate over the same executions.
      const [rows, [rowCount]] = await Promise.all([
        ctx.db
          .select({
            id: taskExecutions.id,
            task: taskDefinitions.name,
            status: taskExecutions.status,
            startedAt: taskExecutions.startedAt,
            completedAt: taskExecutions.completedAt,
            duration: taskExecutions.duration,
            triggeredBy: taskExecutions.triggeredBy,
            error: taskExecutions.error,
          })
          .from(taskExecutions)
          .innerJoin(
            taskDefinitions,
            eq(taskExecutions.taskDefinitionId, taskDefinitions.id)
          )
          .where(where)
          .orderBy(desc(taskExecutions.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(taskExecutions)
          .innerJoin(
            taskDefinitions,
            eq(taskExecutions.taskDefinitionId, taskDefinitions.id)
          )
          .where(where),
      ])

      return { items: rows, total: Number(rowCount?.value ?? 0) }
    }),

  /**
   * 一个任务的完整配置，加上它的执行历史。
   *
   * 列表页给的是"这个任务现在怎么样"——一次开关、一个下次运行时间、一次运行状态。
   * 详情页给的是另外三个列表页回答不了的问题：它**为什么**这样排程（cron 与三个
   * 周期标记之间的矛盾只能在这里看到）、它**历史上**成功过多少次、以及最近一次是
   * 谁触发的。所以这里返回定义的全列、`task_status` 的运行锁、以及一份统计。
   *
   * 统计按状态分组而不是按天数，因为运营要回答的是"这个任务在失败吗"而不是"它
   * 上周失败过几次"；后者的答案就在下面的执行历史里，而前者需要跨全部历史，所以
   * 必须在数据库里聚合，不能把几千行拉到前端再数。
   *
   * 故意**不带** `logs` 与 `result`：那是每一次执行才有的正文，可能很大，而这一页
   * 要展示的是历史表格。它们由 {@link tasks.execution} 在弹窗打开时才取。
   */
  byId: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [definition] = await ctx.db
        .select({
          id: taskDefinitions.id,
          name: taskDefinitions.name,
          description: taskDefinitions.description,
          cronExpression: taskDefinitions.cronExpression,
          isEnabled: taskDefinitions.isEnabled,
          isDaily: taskDefinitions.isDaily,
          isWeekly: taskDefinitions.isWeekly,
          isMonthly: taskDefinitions.isMonthly,
          taskType: taskDefinitions.taskType,
          createdAt: taskDefinitions.createdAt,
          updatedAt: taskDefinitions.updatedAt,
          isRunning: taskStatus.isRunning,
          lastRunAt: taskStatus.lastRunAt,
          nextRunAtStored: taskStatus.nextRunAt,
          lastExecutionId: taskStatus.lastExecutionId,
        })
        .from(taskDefinitions)
        .leftJoin(
          taskStatus,
          eq(taskStatus.taskDefinitionId, taskDefinitions.id)
        )
        .where(eq(taskDefinitions.id, input.id))
        .limit(1)

      if (!definition) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" })
      }

      // The same 500-row window `list` reads, so "next run" here and there are
      // computed from the same evidence rather than from two different samples
      // of a moving table.
      const [recent, stats, totals] = await Promise.all([
        ctx.db
          .select({
            id: taskExecutions.id,
            taskDefinitionId: taskExecutions.taskDefinitionId,
            status: taskExecutions.status,
            startedAt: taskExecutions.startedAt,
            completedAt: taskExecutions.completedAt,
            duration: taskExecutions.duration,
            triggeredBy: taskExecutions.triggeredBy,
            error: taskExecutions.error,
            createdAt: taskExecutions.createdAt,
          })
          .from(taskExecutions)
          .where(eq(taskExecutions.taskDefinitionId, definition.id))
          .orderBy(desc(taskExecutions.createdAt))
          .limit(500),
        ctx.db
          .select({ status: taskExecutions.status, value: count() })
          .from(taskExecutions)
          .where(eq(taskExecutions.taskDefinitionId, definition.id))
          .groupBy(taskExecutions.status),
        ctx.db
          .select({
            value: count(),
            first: sql<Date | null>`min(${taskExecutions.createdAt})`,
            last: sql<Date | null>`max(${taskExecutions.createdAt})`,
            averageDuration: sql<number | null>`avg(${taskExecutions.duration})::float`,
          })
          .from(taskExecutions)
          .where(eq(taskExecutions.taskDefinitionId, definition.id)),
      ])

      const latestByTask = pickLatestByTask(recent)
      const now = new Date()

      return {
        ...definition,
        isRunning: definition.isRunning ?? false,
        total: Number(totals[0]?.value ?? 0),
        firstRunAt: totals[0]?.first ?? null,
        lastRunAtStored: definition.lastRunAt ?? null,
        // `lastRunAt` is the lock's own record of the last start, which can be
        // newer than the newest finished execution while a run is in flight.
        // Both are returned under distinct names rather than merged, because
        // "last started" and "last finished" are different questions and the
        // merge would silently answer one of them with the other's number.
        lastFinishedAt: latestByTask.get(definition.id)?.completedAt ?? null,
        averageDuration:
          totals[0]?.averageDuration == null
            ? null
            : Math.round(totals[0].averageDuration),
        byStatus: Object.fromEntries(
          stats.map((row) => [row.status, Number(row.value)])
        ),
        nextRunAt:
          definition.isEnabled
            ? ((await nextRunAt(
                {
                  name: definition.name,
                  taskType: definition.taskType,
                  cronExpression: definition.cronExpression,
                },
                buildPeriodStates(recent, definition.id),
                now
              )) ?? null)
            : null,
        executions: recent.slice(0, EXECUTION_HISTORY_LIMIT),
      }
    }),

  /**
   * 一次执行的完整内容。
   *
   * 单独一条查询而不是把 `logs` 塞进列表，原因有两个：`logs` 与 `result` 是
   * 这一次执行独有的正文，一次同步任务就能写出几十万字符，把它们挂在历史表格的
   * 每一行上会让打开详情页变成一次几十兆的传输；而它们要显示的地方只有弹窗一个，
   * 所以在弹窗打开时取才是刚好够用的那次查询。
   */
  execution: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: taskExecutions.id,
          status: taskExecutions.status,
          startedAt: taskExecutions.startedAt,
          completedAt: taskExecutions.completedAt,
          duration: taskExecutions.duration,
          result: taskExecutions.result,
          error: taskExecutions.error,
          logs: taskExecutions.logs,
          triggeredBy: taskExecutions.triggeredBy,
          createdAt: taskExecutions.createdAt,
          task: {
            id: taskDefinitions.id,
            name: taskDefinitions.name,
            description: taskDefinitions.description,
            taskType: taskDefinitions.taskType,
            cronExpression: taskDefinitions.cronExpression,
          },
        })
        .from(taskExecutions)
        .innerJoin(
          taskDefinitions,
          eq(taskExecutions.taskDefinitionId, taskDefinitions.id)
        )
        .where(eq(taskExecutions.id, input.id))
        .limit(1)

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Execution not found",
        })
      }

      return row
    }),

  setEnabled: adminProcedure
    .input(z.object({ name: nameSchema, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(taskDefinitions)
        .set({ isEnabled: input.enabled, updatedAt: new Date() })
        .where(eq(taskDefinitions.name, input.name))

      return { name: input.name, isEnabled: input.enabled }
    }),

  /**
   * Runs one task now.
   *
   * `input` is passed through to the task rather than baked into it, so a
   * periodic task can be asked to do a specific instance of its job — the
   * Rising Stars build for a named year, rather than the last complete one it
   * would pick on its own. The task validates it and falls back to its default
   * when it cannot use it, so a malformed value is a default-year run that is
   * visible in the result rather than a failure.
   */
  runNow: adminProcedure
    .input(
      z.object({
        name: nameSchema,
        input: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await seedDefinitions()

      const definition = await getTaskDefinitionByName(ctx.db, input.name)
      if (!definition) {
        throw new TRPCError({
          code: "NOT_FOUND",
          // Readable in a server log, and the code is what the interface
          // translates. A name can go stale between listing the tasks and
          // clicking one, so this is a race the user can actually hit.
          message: `unknown task: ${input.name}`,
          cause: { code: ERROR_CODES.taskNotFound },
        })
      }

      if (!definition.isEnabled) {
        // `as const` like the arms below, so the union stays discriminated and
        // the client can read `.reason` and `.error` without a null check.
        return {
          status: "skipped" as const,
          reason: "task is disabled",
          reasonCode: SKIP_CODES.taskDisabled,
        }
      }

      installTaskRegistry()
      const outcome = await runTask(ctx.db, definition, {
        triggeredBy: "manual",
        logger: createBufferingLogger(),
        ...(input.input ? { input: input.input } : {}),
      })

      if (outcome.status === "skipped") {
        return {
          status: "skipped" as const,
          reason: outcome.reason,
          // A task's own skip reason has no code yet, so this stays undefined
          // and the client falls back to the English prose.
          reasonCode: outcome.reasonCode,
        }
      }
      if (outcome.status === "failed") {
        return { status: "failed" as const, error: outcome.error }
      }
      return { status: "completed" as const }
    }),
})
