import { asc, count, desc, eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { taskDefinitions, taskExecutions, taskStatus } from "@/db/schema"
import { getTaskDefinitionByName } from "@/lib/github/service/task"
import { createBufferingLogger, runTask } from "@/lib/tasks/runner"
import { installTaskRegistry } from "@/lib/tasks/registry"
import { seedDefinitions } from "@/lib/tasks/seed"
import { createTRPCRouter, protectedProcedure } from "../init"
import { ERROR_CODES, SKIP_CODES } from "@/lib/trpc/error-codes"

const statusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
])

const nameSchema = z.string().min(1)

export const tasksRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
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
          nextRunAt: taskStatus.nextRunAt,
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
          duration: taskExecutions.duration,
          triggeredBy: taskExecutions.triggeredBy,
          error: taskExecutions.error,
        })
        .from(taskExecutions)
        .orderBy(desc(taskExecutions.createdAt))
        .limit(500),
    ])

    // Reduced in JS rather than with DISTINCT ON: the newest execution per
    // task is the first row seen for that task in the descending order, and
    // the map keeps one row per task, so a window function in SQL would only
    // add a round trip to compute the same thing.
    const latestByTask = new Map<string, (typeof latest)[number]>()
    for (const row of latest) {
      if (!latestByTask.has(row.taskDefinitionId)) {
        latestByTask.set(row.taskDefinitionId, row)
      }
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      cronExpression: row.cronExpression,
      taskType: row.taskType,
      isEnabled: row.isEnabled,
      isRunning: row.isRunning ?? false,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      lastExecution: latestByTask.get(row.id) ?? null,
    }))
  }),

  executions: protectedProcedure
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

  setEnabled: protectedProcedure
    .input(z.object({ name: nameSchema, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(taskDefinitions)
        .set({ isEnabled: input.enabled, updatedAt: new Date() })
        .where(eq(taskDefinitions.name, input.name))

      return { name: input.name, isEnabled: input.enabled }
    }),

  runNow: protectedProcedure
    .input(z.object({ name: nameSchema }))
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
