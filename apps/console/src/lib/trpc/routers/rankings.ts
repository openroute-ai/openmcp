/**
 * Live ranking reads for the console's dashboard.
 *
 * Thin wrappers over the build services: the dashboard asks for a period, the
 * same computation the build task keys off runs and returns the lists. Without
 * input the queries default to the last complete period, matching both the
 * public endpoints and what the scheduled task would have just published.
 */

import { asc, eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
} from "@/lib/github/service/rankings"
import {
  listMonthlyPeriods,
  listWeeklyPeriods,
} from "@/lib/github/service/available-periods"
import {
  buildRisingStarsForYear,
  computeRisingStarsForYear,
  defaultRisingStarCategories,
  getRisingStarCategories,
  listDefaultRisingStarCategories,
} from "@/lib/github/service/rising-stars"
import {
  risingStarCategories,
  risingStarProjects,
  snapshots,
} from "@/db/schema"
import {
  resolveMonthInput,
  resolveWeekInput,
  resolveYearInput,
} from "@/lib/rankings-web"
import { createTRPCRouter, protectedProcedure } from "../init"

const yearSchema = z.number().int().min(2000).max(9999)
const weekSchema = z.number().int().min(1).max(53)
const monthSchema = z.number().int().min(1).max(12)

/**
 * One editable category.
 *
 * Only the fields the selection actually reads are accepted. `limit`,
 * `availableComments` and `guest` exist on the stored type because the source
 * application's category files carried them, but nothing here consumes them,
 * and accepting them would invite an editor to set something with no effect.
 */
const categorySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "category keys are lowercase slugs"),
  count: z.number().int().min(1).max(1000),
  tags: z.array(z.string().min(1).max(100)).max(100).optional(),
  excludedTags: z.array(z.string().min(1).max(100)).max(100).optional(),
  excluded: z.array(z.string().min(1).max(200)).max(1000).optional(),
  disabled: z.boolean().optional(),
})

/**
 * Codes for the two ways a category configuration is rejected.
 *
 * The editor checks both before it enables save, so these are the backstop for
 * a second operator saving the same year at the same time, or a stale tab. The
 * message is the code rather than prose because the interface translates it —
 * a server string has already been written in one language — and the code is
 * what lets the toast say why in the reader's own.
 */
const CATEGORY_ERROR_CODES = {
  missingAll: "rankings.risingStarsCategories.missingAll",
  duplicateKey: "rankings.risingStarsCategories.duplicateKey",
} as const

export const rankingsRouter = createTRPCRouter({
  /**
   * The weeks and months that hold ranking data, most recent first.
   *
   * Read alongside the rankings themselves: the weekly and monthly queries
   * answer for a period the caller names, and without this the dashboard has
   * no way to know which names are worth offering.
   */
  periods: protectedProcedure.query(async ({ ctx }) => {
    const [weeks, months] = await Promise.all([
      listWeeklyPeriods(ctx.db),
      listMonthlyPeriods(ctx.db),
    ])
    return { weeks, months }
  }),

  weekly: protectedProcedure
    .input(
      z.object({
        year: yearSchema.optional(),
        week: weekSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const target = resolveWeekInput(input)
      if (!target.ok) {
        throw new Error(target.error)
      }
      return buildRankingsForWeek(ctx.db, target.value)
    }),

  monthly: protectedProcedure
    .input(
      z.object({
        year: yearSchema.optional(),
        month: monthSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const target = resolveMonthInput(input)
      if (!target.ok) {
        throw new Error(target.error)
      }
      return buildRankingsForMonth(ctx.db, target.value)
    }),

  /**
   * The report as it currently stands, recomputed from the stored configuration.
   *
   * Read-only. The projection is deterministic, so recomputing on read returns
   * the same numbers a build would write, and a dashboard page view must not be
   * a write — this procedure backs an unauthenticated JSON route as well as
   * this page. `buildRisingStars` is what persists.
   */
  risingStars: protectedProcedure
    .input(z.object({ year: yearSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const year = resolveYearInput(input)
      if (!year.ok) {
        throw new Error(year.error)
      }
      const computed = await computeRisingStarsForYear(ctx.db, year.value)
      return computed.report
    }),

  /**
   * The years a Rising Stars report can be built for, newest first.
   *
   * Two sources, because they answer different questions. A year with monthly
   * star history can be computed; a year with a stored category row is one
   * somebody configured. The current year is always offered, since it is the
   * one a report can be built for as the months come in and it is the year an
   * operator is most likely setting up first.
   */
  risingStarYears: protectedProcedure.query(async ({ ctx }) => {
    const [withHistory, configured, built] = await Promise.all([
      ctx.db
        .selectDistinct({ year: snapshots.year })
        .from(snapshots)
        .orderBy(asc(snapshots.year)),
      ctx.db
        .select({ year: risingStarCategories.year })
        .from(risingStarCategories),
      ctx.db
        .selectDistinct({ year: risingStarProjects.year })
        .from(risingStarProjects),
    ])

    const years = new Set<number>([
      new Date().getFullYear(),
      ...withHistory.map((row) => row.year),
      ...configured.map((row) => row.year),
      ...built.map((row) => row.year),
    ])

    return [...years]
      .sort((a, b) => b - a)
      .map((year) => ({
        year,
        hasHistory: withHistory.some((row) => row.year === year),
        configured: configured.some((row) => row.year === year),
        built: built.some((row) => row.year === year),
      }))
  }),

  /**
   * The seed configuration every year starts from.
   *
   * Served rather than imported so the editor can offer to put it back: the
   * default lives beside the selection that reads it, and importing that module
   * into a client component would pull the Drizzle schema into the browser.
   */
  risingStarDefaultCategories: protectedProcedure.query(() => ({
    categories: listDefaultRisingStarCategories(),
  })),

  /**
   * The category configuration for a year.
   *
   * Read through the same function the report uses, so what an editor sees is
   * what the build will apply — including for a year that has never been
   * configured, which comes back as the default set rather than empty. Nothing
   * is written here: a year nobody has configured has no row, and the editor
   * creates one on save.
   */
  risingStarCategories: protectedProcedure
    .input(z.object({ year: yearSchema }))
    .query(async ({ ctx, input }) => {
      const categories = await getRisingStarCategories(ctx.db, input.year)
      const [row] = await ctx.db
        .select({ updatedAt: risingStarCategories.updatedAt })
        .from(risingStarCategories)
        .where(eq(risingStarCategories.year, input.year))

      return {
        year: input.year,
        categories,
        // `null` means the year was never configured and what is on screen is
        // the seed rather than anything an operator chose. The editor says so
        // instead of showing a save date for a row that does not exist.
        updatedAt: row?.updatedAt ?? null,
        // Whether this is the untouched default, so the editor can offer to
        // put it back rather than an operator wondering what the original was.
        isDefault:
          JSON.stringify(categories) ===
          JSON.stringify(defaultRisingStarCategories),
      }
    }),

  /**
   * Replaces a year's category configuration.
   *
   * A full replace rather than a diff: the whole list is a few dozen short
   * rows that the editor already holds, and a merge would have to resolve
   * deletions, which is the one operation a merge cannot express.
   *
   * The "all" bucket is required, because the selection throws without it and
   * a report that cannot be built is not a state worth storing.
   */
  setRisingStarCategories: protectedProcedure
    .input(
      z.object({
        year: yearSchema,
        categories: z.array(categorySchema).min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.categories.some((category) => category.key === "all")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: CATEGORY_ERROR_CODES.missingAll,
          cause: { code: CATEGORY_ERROR_CODES.missingAll },
        })
      }

      const keys = input.categories.map((category) => category.key)
      if (new Set(keys).size !== keys.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: CATEGORY_ERROR_CODES.duplicateKey,
          cause: { code: CATEGORY_ERROR_CODES.duplicateKey },
        })
      }

      const [stored] = await ctx.db
        .insert(risingStarCategories)
        .values({
          year: input.year,
          categories: input.categories,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: risingStarCategories.year,
          set: { categories: input.categories, updatedAt: new Date() },
        })
        .returning({ year: risingStarCategories.year })

      return {
        year: stored?.year ?? input.year,
        count: input.categories.length,
      }
    }),

  /**
   * Rebuilds a year's report from its current configuration.
   *
   * The build writes the selection to `rising_star_projects` and returns the
   * artefact, so saving categories alone would not change the report until the
   * yearly task happened to run again. This is what an editor presses to see
   * the effect of what they just saved.
   */
  buildRisingStars: protectedProcedure
    .input(z.object({ year: yearSchema }))
    .mutation(async ({ ctx, input }) => {
      const report = await buildRisingStarsForYear(ctx.db, input.year)
      return { year: input.year, count: report.count }
    }),
})
