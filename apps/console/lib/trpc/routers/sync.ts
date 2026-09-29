import { desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import {
  SYNC_JOB_STATUSES,
  projectSyncJobs,
  projects,
  readmeSyncJobs,
  repos,
} from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

export const syncRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(SYNC_JOB_STATUSES).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const [projectRows, readmeRows] = await Promise.all([
        ctx.db
          .select({
            id: projectSyncJobs.id,
            ref: projects.name,
            status: projectSyncJobs.status,
            triggeredBy: projectSyncJobs.triggeredBy,
            errorMessage: projectSyncJobs.errorMessage,
            startedAt: projectSyncJobs.startedAt,
            completedAt: projectSyncJobs.completedAt,
            retryCount: projectSyncJobs.retryCount,
            createdAt: projectSyncJobs.createdAt,
          })
          .from(projectSyncJobs)
          .innerJoin(projects, eq(projectSyncJobs.projectId, projects.id))
          .where(
            input.status ? eq(projectSyncJobs.status, input.status) : undefined
          )
          .orderBy(desc(projectSyncJobs.createdAt))
          .limit(input.limit),
        ctx.db
          .select({
            id: readmeSyncJobs.id,
            ref: sql<string>`${repos.owner} || '/' || ${repos.name}`,
            status: readmeSyncJobs.status,
            triggeredBy: readmeSyncJobs.triggeredBy,
            errorMessage: readmeSyncJobs.errorMessage,
            startedAt: readmeSyncJobs.startedAt,
            completedAt: readmeSyncJobs.completedAt,
            retryCount: readmeSyncJobs.retryCount,
            createdAt: readmeSyncJobs.createdAt,
          })
          .from(readmeSyncJobs)
          .innerJoin(repos, eq(readmeSyncJobs.repoId, repos.id))
          .where(
            input.status ? eq(readmeSyncJobs.status, input.status) : undefined
          )
          .orderBy(desc(readmeSyncJobs.createdAt))
          .limit(input.limit),
      ])

      const merged = [
        ...projectRows.map((row) => ({ ...row, kind: "project" as const })),
        ...readmeRows.map((row) => ({ ...row, kind: "readme" as const })),
      ]

      merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return merged.slice(0, input.limit)
    }),
})
