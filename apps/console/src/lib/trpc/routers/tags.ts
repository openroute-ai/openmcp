import { eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { projectsToTags, tags } from "@/db/schema"
import { deleteTag, listTags, upsertTag } from "@/lib/github/service/tag"
import { createTRPCRouter, protectedProcedure } from "../init"

/**
 * Tag vocabulary management.
 *
 * Assignment lives on `projects.setTags`, because that is a property of a
 * project. This router owns the tags themselves: the list an editor picks
 * from, and the create/rename/delete an editor needs to change the vocabulary
 * in the first place.
 */
export const tagsRouter = createTRPCRouter({
  /**
   * Every tag in use, for the assignment picker.
   *
   * Not paginated: the vocabulary is a small, curated set that the picker
   * shows in full, so a second round trip to discover a second page would only
   * add a way for an editor to miss a tag that exists.
   */
  list: protectedProcedure.query(async ({ ctx }) => listTags(ctx.db)),

  /**
   * Creates a tag, or edits the mutable fields of one that already exists.
   *
   * `code` is the stable identifier, so an existing tag is found by its code
   * and renaming one only changes how it reads. That is what lets the project
   * editor retype a tag's name without orphaning the assignments that
   * reference its code.
   */
  upsert: protectedProcedure
    .input(
      z.object({
        code: z
          .string()
          .min(1)
          .max(64)
          .regex(
            /^[a-z0-9]+(-[a-z0-9]+)*$/,
            "Use lower-case words separated by single hyphens"
          ),
        name: z.string().min(1).max(64),
        description: z.string().max(500).nullable().optional(),
        aliases: z.array(z.string().min(1).max(64)).max(50).optional(),
        excludeFromRankings: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => upsertTag(ctx.db, input)),

  /**
   * Deletes a tag and drops it from every project that carries it.
   *
   * Refuses to delete a tag that is still assigned. Silently stripping the tag
   * from a ranked project would change what the rankings say without telling
   * anyone, and the caller can unassign it first if that was the intent.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [tag] = await ctx.db
        .select({ id: tags.id, code: tags.code })
        .from(tags)
        .where(eq(tags.id, input.id))
      if (!tag) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" })
      }

      const [assigned] = await ctx.db
        .select({ projectId: projectsToTags.projectId })
        .from(projectsToTags)
        .where(eq(projectsToTags.tagId, tag.id))
        .limit(1)
      if (assigned) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Tag "${tag.code}" is still assigned to a project. Unassign it first.`,
        })
      }

      await deleteTag(ctx.db, tag.id)
      return { id: tag.id }
    }),
})
