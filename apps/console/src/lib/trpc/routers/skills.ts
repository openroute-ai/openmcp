import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { z } from "zod"
import { projects, projectSkills } from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

const skillStatusSchema = z
  .enum(["all", "pending", "synced", "error"])
  .default("all")

export const skillsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        status: skillStatusSchema,
        limit: z.number().int().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const where =
        input.status === "pending"
          ? and(
              isNull(projectSkills.syncedToWebAt),
              isNull(projectSkills.lastSyncError)
            )
          : input.status === "synced"
            ? isNotNull(projectSkills.syncedToWebAt)
            : input.status === "error"
              ? isNotNull(projectSkills.lastSyncError)
              : undefined

      return ctx.db
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
    }),
})
