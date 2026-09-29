import { desc, eq, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  projectSkills,
  projectSyncJobs,
  projects,
  repos,
} from "@/db/schema"
import {
  InvalidRepoUrlError,
  createProjectFromRepo,
} from "@/lib/github/service/create-project"
import { parseGithubRepoUrl } from "@/lib/github/repo-url"
import { createConsoleLogger } from "@/lib/tasks/runner"
import { createTRPCRouter, protectedProcedure } from "../init"

export const projectsRouter = createTRPCRouter({
  /**
   * Curates a new project from a GitHub URL.
   *
   * Idempotent: a repository that already has a project returns that project
   * with `status: "existing"`, so a double submit is harmless.
   */
  create: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1),
        // Defaults to the reference app's default, so an omitted type does not
        // silently publish something as a skill.
        type: z.enum(PROJECT_TYPES).default("application"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProjectFromRepo(
          ctx.db,
          { url: input.url, type: input.type },
          { logger: createConsoleLogger("create-project") }
        )
      } catch (error) {
        if (error instanceof InvalidRepoUrlError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error,
          })
        }
        throw error
      }
    }),

  /**
   * Normalizes a URL without creating anything, for the preview shown while
   * the operator is still typing.
   */
  parseUrl: protectedProcedure
    .input(z.object({ url: z.string().min(1) }))
    .query(({ input }) => parseGithubRepoUrl(input.url)),

  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(PROJECT_STATUSES).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const [rows, skillCounts, latestJobs] = await Promise.all([
        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            owner: projects.owner,
            slug: projects.slug,
            description: projects.description,
            type: projects.type,
            status: projects.status,
            priority: projects.priority,
            logo: projects.logo,
            stars: repos.stars,
            forks: repos.forks,
            pushedAt: repos.pushedAt,
            repoUrl: sql<string>`'https://github.com/' || ${repos.owner} || '/' || ${repos.name}`,
          })
          .from(projects)
          .leftJoin(repos, eq(projects.repoId, repos.id))
          .where(input.status ? eq(projects.status, input.status) : undefined)
          .orderBy(desc(projects.createdAt))
          .limit(input.limit),
        ctx.db
          .select({
            projectId: projectSkills.projectId,
            count: sql<number>`count(*)::int`,
          })
          .from(projectSkills)
          .groupBy(projectSkills.projectId),
        ctx.db
          .select({
            id: projectSyncJobs.id,
            projectId: projectSyncJobs.projectId,
            status: projectSyncJobs.status,
            triggeredBy: projectSyncJobs.triggeredBy,
            startedAt: projectSyncJobs.startedAt,
            completedAt: projectSyncJobs.completedAt,
            createdAt: projectSyncJobs.createdAt,
          })
          .from(projectSyncJobs)
          .orderBy(desc(projectSyncJobs.createdAt))
          .limit(500),
      ])

      const skillsByProject = new Map(
        skillCounts.map((row) => [row.projectId, row.count])
      )

      // Newest first, so the first row seen for a project is its latest job.
      const jobByProject = new Map<string, (typeof latestJobs)[number]>()
      for (const job of latestJobs) {
        if (!jobByProject.has(job.projectId)) {
          jobByProject.set(job.projectId, job)
        }
      }

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        owner: row.owner,
        slug: row.slug,
        description: row.description,
        type: row.type,
        status: row.status,
        priority: row.priority,
        logo: row.logo,
        stars: row.stars,
        forks: row.forks,
        pushedAt: row.pushedAt,
        repoUrl: row.repoUrl,
        skillCount: skillsByProject.get(row.id) ?? 0,
        lastSync: jobByProject.get(row.id) ?? null,
      }))
    }),
})
