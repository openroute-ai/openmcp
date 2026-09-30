import { eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { hallOfFame } from "@/db/schema"
import {
  listAuthors,
  refreshAuthorProfile,
  upsertAuthor,
} from "@/lib/github/service/hall-of-fame"
import { createTRPCRouter, protectedProcedure } from "../init"

/**
 * The author directory.
 *
 * Separate from `projects` because an author outlives the project that first
 * introduced them: one owner can have several curated repositories, and the
 * profile belongs to the account rather than to any one of them.
 */
export const authorsRouter = createTRPCRouter({
  /**
   * Every recorded author.
   *
   * Not paginated: one row per GitHub account with a curated repository, which
   * is a list an operator reads end to end rather than a log they scan.
   *
   * Sorted by followers rather than by login, because the point of the list is
   * to show which bylines matter; an unrefreshed author has no follower count
   * and sorts last, which is the honest position for a row nothing is known
   * about. A search term narrows it, for the same reason a list this size needs
   * one.
   */
  list: protectedProcedure
    .input(
      z.object({ search: z.string().trim().max(200).optional() }).optional()
    )
    .query(async ({ ctx, input }) => {
      const term = input?.search
      const rows = await listAuthors(ctx.db, term)
      return rows.map((row) => ({
        username: row.username,
        name: row.name,
        bio: row.bio,
        homepage: row.homepage,
        twitter: row.twitter,
        linkedin: row.linkedin,
        github: row.github,
        avatar: row.avatar,
        avatarUrl: row.avatarUrl,
        followers: row.followers,
        verified: row.verified,
        status: row.status,
        npmUsername: row.npmUsername,
        npmPackageCount: row.npmPackageCount,
        updatedAt: row.updatedAt,
      }))
    }),

  /**
   * Refetches one author from GitHub.
   *
   * On demand rather than only during a project refresh, because a refresh is
   * tied to a repository changing while this is tied to the operator deciding
   * the card is wrong. It also costs a GraphQL request, which is why it is a
   * button and not something every page view does for you.
   *
   * A failure is returned rather than thrown, so a rate limit reads as a
   * refresh that did not happen instead of an error page over a byline.
   */
  refresh: protectedProcedure
    .input(z.object({ username: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const result = await refreshAuthorProfile(ctx.db, input.username)
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error,
        })
      }
      return result.author
    }),

  /**
   * Edits the fields a GitHub profile cannot supply.
   *
   * `linkedin` and the npm details are not on the GitHub profile, so there is
   * nothing to refresh them from and a console is the only way to set them. A
   * later profile refresh leaves them alone for that reason.
   */
  update: protectedProcedure
    .input(
      z.object({
        username: z.string().min(1).max(100),
        name: z.string().min(1).max(200).optional(),
        bio: z.string().max(2000).nullable().optional(),
        homepage: z.string().max(500).nullable().optional(),
        twitter: z.string().max(200).nullable().optional(),
        linkedin: z.string().max(500).nullable().optional(),
        npmUsername: z.string().max(100).nullable().optional(),
        npmPackageCount: z.number().int().min(0).nullable().optional(),
        verified: z.boolean().optional(),
        status: z.enum(["active", "inactive", "archived"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ username: hallOfFame.username })
        .from(hallOfFame)
        .where(eq(hallOfFame.username, input.username))
        .limit(1)
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Author not found" })
      }

      const { username, ...fields } = input
      await upsertAuthor(
        ctx.db,
        {
          username,
          verified: fields.verified,
          status: fields.status,
        },
        {
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.bio !== undefined ? { bio: fields.bio } : {}),
          ...(fields.homepage !== undefined
            ? { homepage: fields.homepage }
            : {}),
          ...(fields.twitter !== undefined ? { twitter: fields.twitter } : {}),
          ...(fields.linkedin !== undefined
            ? { linkedin: fields.linkedin }
            : {}),
          ...(fields.npmUsername !== undefined
            ? { npmUsername: fields.npmUsername }
            : {}),
          ...(fields.npmPackageCount !== undefined
            ? { npmPackageCount: fields.npmPackageCount }
            : {}),
        }
      )

      return { username }
    }),
})
