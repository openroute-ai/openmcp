import { count, desc, eq, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  SYNC_JOB_STATUSES,
  projectSyncJobs,
  projects,
  readmeSyncJobs,
  repos,
} from "@/db/schema"
import { retryProjectSyncJob } from "@/lib/github/service/resync"
import { createTRPCRouter, adminProcedure } from "../init"

export const syncRouter = createTRPCRouter({
  /**
   * The sync log, newest first, across both kinds of job.
   *
   * Paging two tables merged into one list is the awkward part. It is done by
   * reading `offset + limit` rows from each side and slicing in memory rather
   * than by a `UNION`: the first `offset + limit` rows of the merged order are
   * always contained within the first `offset + limit` rows of each source,
   * so the window cannot miss a row that belongs on the page, and it keeps the
   * query in the type system instead of hand-written SQL against column names.
   * The trade is reading a few rows more than the page needs.
   */
  list: adminProcedure
    .input(
      z.object({
        status: z.enum(SYNC_JOB_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const window = input.offset + input.limit

      const [projectRows, readmeRows, projectCount, readmeCount] =
        await Promise.all([
          ctx.db
            .select({
              id: projectSyncJobs.id,
              projectId: projectSyncJobs.projectId,
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
              input.status
                ? eq(projectSyncJobs.status, input.status)
                : undefined
            )
            .orderBy(desc(projectSyncJobs.createdAt))
            .limit(window),
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
              input.status
                ? eq(readmeSyncJobs.status, input.status)
                : undefined
            )
            .orderBy(desc(readmeSyncJobs.createdAt))
            .limit(window),
          ctx.db
            .select({ value: count() })
            .from(projectSyncJobs)
            .innerJoin(projects, eq(projectSyncJobs.projectId, projects.id))
            .where(
              input.status
                ? eq(projectSyncJobs.status, input.status)
                : undefined
            ),
          ctx.db
            .select({ value: count() })
            .from(readmeSyncJobs)
            .innerJoin(repos, eq(readmeSyncJobs.repoId, repos.id))
            .where(
              input.status
                ? eq(readmeSyncJobs.status, input.status)
                : undefined
            ),
        ])

      const merged = [
        ...projectRows.map((row) => ({ ...row, kind: "project" as const })),
        ...readmeRows.map((row) => ({ ...row, kind: "readme" as const })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      return {
        items: merged.slice(input.offset, input.offset + input.limit),
        total: Number(projectCount[0]?.value ?? 0) + Number(readmeCount[0]?.value ?? 0),
      }
    }),

  /**
   * Retries a failed job by starting a new one.
   *
   * A retry is a new job row rather than a reopened one, so the failure stays
   * in the log and `retryCount` records how many attempts it took. Only project
   * jobs are retryable here: a readme job is one stage of a project sync that
   * the readme task owns, and rerunning the project pipeline is the action that
   * actually covers it.
   */
  retry: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [readmeJob] = await ctx.db
        .select({ id: readmeSyncJobs.id })
        .from(readmeSyncJobs)
        .where(eq(readmeSyncJobs.id, input.id))
        .limit(1)
      if (readmeJob) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "a readme sync is part of a project sync; retry that project instead",
        })
      }

      return retryProjectSyncJob(ctx.db, input.id)
    }),
})
