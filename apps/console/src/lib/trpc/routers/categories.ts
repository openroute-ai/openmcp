import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { categories, projects, repos } from "@/db/schema"
import {
  deleteCategory,
  getCategoryByCode,
  upsertCategory,
} from "@/lib/github/service/category"
import { createTRPCRouter, adminProcedure } from "../init"

/** The `code` shape every category slug has to keep, mirrored from `tags`. */
const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The star count in one direction, with the projects that have none last.
 *
 * `repos.stars` is nullable, and Postgres sorts nulls first under `DESC`, so the
 * most-starred order would otherwise open with every unsynced project.
 */
function orderStars(direction: "asc" | "desc") {
  return sql`${repos.stars} ${sql.raw(direction)} nulls last`
}

/**
 * The category taxonomy, curated by an operator.
 *
 * `list`, `create`, `update`, `remove` are `adminProcedure`: the table decides
 * what the classifier may answer and what the public `/categories` nav shows, so
 * changing it is an operator's act. `projects` is admin too — the detail page it
 * backs is behind the dashboard gate — and reads the same `category_id` the
 * public site filters by.
 */
export const categoriesRouter = createTRPCRouter({
  /**
   * Every category, in the order an operator arranged it.
   *
   * Each row carries the number of projects filed under it (`projectCount`), so
   * the list can say "12 个项目" without a second round trip per row, and so the
   * delete confirmation can warn before a category with projects is removed.
   *
   * Not paginated on purpose: the taxonomy is a small curated set that the
   * operator reads in full, exactly like the tag vocabulary the picker shows
   * whole. A second page would only add a way to miss a category that exists.
   */
  list: adminProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(200).optional(),
          activeOnly: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const opts = input ?? {}
      const conditions: SQL[] = []
      if (opts.activeOnly) conditions.push(eq(categories.isActive, true))

      const term = opts.search?.trim()
      if (term) {
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
        conditions.push(
          sql`(${ilike(categories.name, pattern)} or ${ilike(
            categories.code,
            pattern
          )} or ${ilike(categories.description, pattern)})`
        )
      }

      const rows = await ctx.db
        .select({
          id: categories.id,
          code: categories.code,
          name: categories.name,
          description: categories.description,
          isActive: categories.isActive,
          sortOrder: categories.sortOrder,
          createdAt: categories.createdAt,
          updatedAt: categories.updatedAt,
          projectCount: count(projects.id),
        })
        .from(categories)
        .leftJoin(projects, eq(projects.categoryId, categories.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(categories.id)
        .orderBy(asc(categories.sortOrder), asc(categories.name))

      return rows.map((row) => ({
        ...row,
        projectCount: Number(row.projectCount),
      }))
    }),

  /** One category by its stable `code`, for the detail and edit surfaces. */
  get: adminProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const cat = await getCategoryByCode(ctx.db, input.code)
      if (!cat) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Category not found",
        })
      }
      return cat
    }),

  /**
   * Creates a category, or edits one whose `code` is already taken.
   *
   * `code` is the stable identifier and is never rewritten: it is the value the
   * classifier is allowed to answer with, so renaming a category must not orphan
   * the `category_id` of every project filed under it. New rows are what the
   * form's create path exercises; the conflict branch exists so a double submit
   * is harmless rather than a unique-violation error.
   */
  create: adminProcedure
    .input(
      z.object({
        code: z
          .string()
          .min(1)
          .max(64)
          .regex(slugRegex, "Use lower-case words separated by single hyphens"),
        name: z.string().min(1).max(64),
        description: z.string().max(500).nullable().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().min(-1000).max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => upsertCategory(ctx.db, input)),

  /**
   * Edits the mutable fields of a category, leaving `code` alone.
   *
   * Updated by `id` rather than through `upsertCategory`, whose conflict target
   * is `code`: routing an edit through it would read a changed code as a new
   * category and insert a second row. A category that needs a different slug is
   * created fresh and the old one retired with `isActive: false`.
   */
  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(64).optional(),
        description: z.string().max(500).nullable().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().min(-1000).max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(categories)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(categories.id, input.id))
        .returning()

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Category not found",
        })
      }
      return row
    }),

  /**
   * Deletes a category.
   *
   * `projects.category_id` is `ON DELETE SET NULL`, so the projects survive and
   * return to the unclassified state rather than being deleted with the shelf.
   * The changes are reported back so the confirmation can say how many were
   * unfiled.
   */
  remove: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [cat] = await ctx.db
        .select({ id: categories.id, code: categories.code })
        .from(categories)
        .where(eq(categories.id, input.id))
      if (!cat) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Category not found",
        })
      }

      const [affected] = await ctx.db
        .select({ total: count() })
        .from(projects)
        .where(eq(projects.categoryId, input.id))

      await deleteCategory(ctx.db, input.id)
      return {
        id: input.id,
        code: cat.code,
        unfiled: Number(affected?.total ?? 0),
      }
    }),

  /**
   * One page of the projects filed under a category, for the detail page.
   *
   * Paged and searched in SQL rather than in the client: the total and the rows
   * come from the same `where` clause, so a filtered page cannot report a total
   * the server never agreed with. Hidden projects are included — this is the
   * operator's view of the shelf, not the public one — and the sort is the same
   * `-stars` default the project list opens with, with `id` as the unique
   * tiebreaker so equal star counts cannot appear twice or vanish between pages.
   */
  projects: adminProcedure
    .input(
      z.object({
        code: z.string().min(1),
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        sort: z
          .enum(["-stars", "stars", "-createdAt", "createdAt"])
          .default("-stars"),
      })
    )
    .query(async ({ ctx, input }) => {
      const cat = await getCategoryByCode(ctx.db, input.code)
      if (!cat) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Category not found",
        })
      }

      const conditions: SQL[] = [eq(projects.categoryId, cat.id)]
      const term = input.search?.trim()
      if (term) {
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
        conditions.push(
          sql`(${ilike(projects.name, pattern)} or ${ilike(
            projects.owner,
            pattern
          )} or ${ilike(projects.description, pattern)})`
        )
      }

      const whereClause = and(...conditions)

      const orderBy = (() => {
        if (input.sort === "-stars")
          return [orderStars("desc"), asc(projects.id)]
        if (input.sort === "stars") return [orderStars("asc"), asc(projects.id)]
        if (input.sort === "createdAt")
          return [asc(projects.createdAt), asc(projects.id)]
        return [desc(projects.createdAt), asc(projects.id)]
      })()

      const [countRow, rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(projects)
          .innerJoin(repos, eq(projects.repoId, repos.id))
          .where(whereClause),
        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            owner: projects.owner,
            description: projects.description,
            status: projects.status,
            type: projects.type,
            stars: repos.stars,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .innerJoin(repos, eq(projects.repoId, repos.id))
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(input.limit)
          .offset(input.offset),
      ])

      return {
        category: cat,
        items: rows.map((row) => ({ ...row, stars: row.stars ?? 0 })),
        total: Number(countRow[0]?.total ?? 0),
      }
    }),
})
