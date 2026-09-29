import { asc, desc, eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { taskDefinitions, taskExecutions, taskStatus } from "@/db/schema"
import { getTaskDefinitionByName } from "@/lib/github/service/task"
import { createBufferingLogger, runTask } from "@/lib/tasks/runner"
import { installTaskRegistry } from "@/lib/tasks/registry"
import { seedDefinitions } from "@/lib/tasks/seed"
import { createTRPCRouter, protectedProcedure } from "../init"

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
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
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
        .where(
          input.status ? eq(taskExecutions.status, input.status) : undefined
        )
        .orderBy(desc(taskExecutions.createdAt))
        .limit(input.limit)
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
          message: `unknown task: ${input.name}`,
        })
      }

      if (!definition.isEnabled) {
        return { status: "skipped", reason: "task is disabled" }
      }

      installTaskRegistry()
      const outcome = await runTask(ctx.db, definition, {
        triggeredBy: "manual",
        logger: createBufferingLogger(),
      })

      if (outcome.status === "skipped") {
        return { status: "skipped" as const, reason: outcome.reason }
      }
      if (outcome.status === "failed") {
        return { status: "failed" as const, error: outcome.error }
      }
      return { status: "completed" as const }
    }),
})
