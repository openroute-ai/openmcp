import { desc, eq, gte, sql } from "drizzle-orm"
import {
  projectSkills,
  projectSyncJobs,
  projects,
  readmeSyncJobs,
  repos,
  taskDefinitions,
  taskExecutions,
  taskStatus,
} from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

const DAY_MS = 24 * 60 * 60 * 1000

function byStatus(
  rows: { status: string; count: number }[]
): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.status, row.count]))
}

export const overviewRouter = createTRPCRouter({
  snapshot: protectedProcedure.query(async ({ ctx }) => {
    const dayAgo = new Date(Date.now() - DAY_MS)

    const [
      repoRow,
      projectRow,
      skillRow,
      taskRow,
      executions,
      projectJobs,
      readmeJobs,
      recentExecutions,
    ] = await Promise.all([
      ctx.db
        .select({ value: sql<number>`count(*)::int` })
        .from(repos)
        .then((rows) => rows[0]),
      ctx.db
        .select({ value: sql<number>`count(*)::int` })
        .from(projects)
        .then((rows) => rows[0]),
      ctx.db
        .select({
          total: sql<number>`count(*)::int`,
          synced: sql<number>`count(*) filter (where ${projectSkills.syncedToWebAt} is not null)::int`,
          pending: sql<number>`count(*) filter (where ${projectSkills.syncedToWebAt} is null and ${projectSkills.lastSyncError} is null)::int`,
          failed: sql<number>`count(*) filter (where ${projectSkills.lastSyncError} is not null)::int`,
        })
        .from(projectSkills)
        .then((rows) => rows[0]),
      ctx.db
        .select({
          total: sql<number>`count(*)::int`,
          enabled: sql<number>`count(*) filter (where ${taskDefinitions.isEnabled})::int`,
          running: sql<number>`count(*) filter (where ${taskStatus.isRunning})::int`,
        })
        .from(taskDefinitions)
        .leftJoin(
          taskStatus,
          eq(taskStatus.taskDefinitionId, taskDefinitions.id)
        )
        .then((rows) => rows[0]),
      ctx.db
        .select({
          status: taskExecutions.status,
          count: sql<number>`count(*)::int`,
        })
        .from(taskExecutions)
        .where(gte(taskExecutions.createdAt, dayAgo))
        .groupBy(taskExecutions.status),
      ctx.db
        .select({
          status: projectSyncJobs.status,
          count: sql<number>`count(*)::int`,
        })
        .from(projectSyncJobs)
        .where(gte(projectSyncJobs.createdAt, dayAgo))
        .groupBy(projectSyncJobs.status),
      ctx.db
        .select({
          status: readmeSyncJobs.status,
          count: sql<number>`count(*)::int`,
        })
        .from(readmeSyncJobs)
        .where(gte(readmeSyncJobs.createdAt, dayAgo))
        .groupBy(readmeSyncJobs.status),
      ctx.db
        .select({
          id: taskExecutions.id,
          task: taskDefinitions.name,
          status: taskExecutions.status,
          startedAt: taskExecutions.startedAt,
          duration: taskExecutions.duration,
          triggeredBy: taskExecutions.triggeredBy,
          error: taskExecutions.error,
        })
        .from(taskExecutions)
        .innerJoin(
          taskDefinitions,
          eq(taskExecutions.taskDefinitionId, taskDefinitions.id)
        )
        .orderBy(desc(taskExecutions.createdAt))
        .limit(8),
    ])

    const executionCounts = byStatus(executions)
    const jobCounts = byStatus([...projectJobs, ...readmeJobs])

    return {
      repos: repoRow?.value ?? 0,
      projects: projectRow?.value ?? 0,
      skills: {
        total: skillRow?.total ?? 0,
        synced: skillRow?.synced ?? 0,
        pending: skillRow?.pending ?? 0,
        failed: skillRow?.failed ?? 0,
      },
      tasks: {
        total: taskRow?.total ?? 0,
        enabled: taskRow?.enabled ?? 0,
        running: taskRow?.running ?? 0,
      },
      executionsToday: {
        pending: executionCounts.pending ?? 0,
        running: executionCounts.running ?? 0,
        completed: executionCounts.completed ?? 0,
        failed: executionCounts.failed ?? 0,
        cancelled: executionCounts.cancelled ?? 0,
      },
      jobsToday: {
        pending: jobCounts.pending ?? 0,
        running: jobCounts.running ?? 0,
        success: jobCounts.success ?? 0,
        failed: jobCounts.failed ?? 0,
      },
      recentExecutions,
    }
  }),
})
