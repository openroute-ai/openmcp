import { and, count, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { projects, projectSkills, repos } from "@/db/schema"
import { syncEnv } from "@/lib/env"
import { pushSkill } from "@/lib/github/service/push-skill"
import { createTRPCRouter, adminProcedure } from "../init"

const skillStatusSchema = z
  .enum(["all", "pending", "synced", "error"])
  .default("all")

/**
 * Wraps a search term for `ILIKE`.
 *
 * The wildcards are escaped so a term containing `%` or `_` searches for those
 * characters instead of turning the query into a scan-everything pattern.
 */
function pattern(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

export const skillsRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z.object({
        status: skillStatusSchema,
        search: z.string().max(200).default(""),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        input.status === "pending"
          ? and(
              isNull(projectSkills.syncedToWebAt),
              isNull(projectSkills.lastSyncError)
            )
          : input.status === "synced"
            ? isNotNull(projectSkills.syncedToWebAt)
            : input.status === "error"
              ? isNotNull(projectSkills.lastSyncError)
              : undefined,
        input.search.trim() === ""
          ? undefined
          : or(
              ilike(projects.name, pattern(input.search)),
              ilike(projects.owner, pattern(input.search)),
              ilike(projectSkills.name, pattern(input.search)),
              ilike(projectSkills.skillDir, pattern(input.search))
            )
      )

      // The count shares the filter and the join, so the page count cannot
      // disagree with the rows: both read the same predicate over the same
      // rows, and neither is a second definition of "which skills".
      const [rows, [rowCount]] = await Promise.all([
        ctx.db
          .select({
            id: projectSkills.id,
            projectId: projectSkills.projectId,
            projectName: projects.name,
            projectOwner: projects.owner,
            skillDir: projectSkills.skillDir,
            name: projectSkills.name,
            descriptionZh: projectSkills.descriptionZh,
            readmeZh: projectSkills.readmeZh,
            contentHash: projectSkills.contentHash,
            syncedToWebAt: projectSkills.syncedToWebAt,
            lastSyncAttemptAt: projectSkills.lastSyncAttemptAt,
            lastSyncError: projectSkills.lastSyncError,
            updatedAt: projectSkills.updatedAt,
          })
          .from(projectSkills)
          .innerJoin(projects, eq(projectSkills.projectId, projects.id))
          .where(where)
          .orderBy(desc(projectSkills.updatedAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(projectSkills)
          .innerJoin(projects, eq(projectSkills.projectId, projects.id))
          .where(where),
      ])

      return { items: rows, total: Number(rowCount?.value ?? 0) }
    }),

  /**
   * One skill, with the project and repository it is delivered from.
   *
   * The repository is joined in because the webhook identifies its subject by
   * owner and name, and because the detail page links out to the source — a
   * skill row alone cannot answer either.
   */
  byId: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          skill: projectSkills,
          project: {
            id: projects.id,
            name: projects.name,
            owner: projects.owner,
            slug: projects.slug,
            status: projects.status,
            type: projects.type,
          },
          repo: {
            owner: repos.owner,
            name: repos.name,
            homepage: repos.homepage,
          },
        })
        .from(projectSkills)
        .innerJoin(projects, eq(projectSkills.projectId, projects.id))
        .innerJoin(repos, eq(projects.repoId, repos.id))
        .where(eq(projectSkills.id, input.id))
        .limit(1)

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" })
      }
      return row
    }),

  /**
   * Pushes one skill to the web service now.
   *
   * The same call the `push-skills` task makes for its retry queue, so a
   * delivery that an operator triggers by hand and one the scheduler retries
   * are indistinguishable downstream. The task remains the thing that sweeps
   * the queue; this is the button for the row someone is looking at.
   */
  push: adminProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        skillDir: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const env = syncEnv()
      const webhookUrl = env.SKILLS_WEBHOOK_URL
      if (!webhookUrl) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: 'No "SKILLS_WEBHOOK_URL" env. variable!',
        })
      }

      return pushSkill(ctx.db, input, {
        webhookUrl,
        secret: env.GITHUB_DATA_WEBHOOK_SECRET,
        token: env.SKILLS_WEBHOOK_TOKEN,
      })
    }),
})
