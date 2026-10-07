import { eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { projectsToTags, tags } from "@/db/schema"
import { deleteTag, listTags, upsertTag } from "@/lib/github/service/tag"
import { listCategories } from "@/lib/github/service/category"
import { createTRPCRouter, adminProcedure, protectedProcedure } from "../init"

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
  list: adminProcedure.query(async ({ ctx }) => listTags(ctx.db)),

  /**
   * 运营分类，给订阅过滤器的多选下拉用（`categories.code` + 展示名）。
   *
   * `protectedProcedure` 而不是 admin：过滤是**读**，而 `list` / `upsert` / `remove`
   * 改的是分类表本身——让普通订阅方看见分类清单，与让他改分类清单是两件事。
   *
   * 也不带 `activeOnly`：停用一个分类只是让它不再有新项目，归档在它名下的仓库仍然
   * 是这条订阅要推的东西。下拉里少一个选项，会让一条早已配好的订阅在读者只是打开
   * 看了一眼之后，于下次保存时悄悄缩小范围。
   */
  categories: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listCategories(ctx.db)
    return rows.map((row) => ({ code: row.code, name: row.name }))
  }),

  /**
   * Creates a tag, or edits the mutable fields of one that already exists.
   *
   * `code` is the stable identifier, so an existing tag is found by its code
   * and renaming one only changes how it reads. That is what lets the project
   * editor retype a tag's name without orphaning the assignments that
   * reference its code.
   */
  upsert: adminProcedure
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
  remove: adminProcedure
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
