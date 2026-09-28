/**
 * Live ranking reads for the console's dashboard.
 *
 * Thin wrappers over the build services: the dashboard asks for a period, the
 * same computation the build task keys off runs and returns the lists. Without
 * input the queries default to the last complete period, matching both the
 * public endpoints and what the scheduled task would have just published.
 */

import { z } from "zod"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
} from "@/lib/github/service/rankings"
import { buildRisingStarsForYear } from "@/lib/github/service/rising-stars"
import {
  resolveMonthInput,
  resolveWeekInput,
  resolveYearInput,
} from "@/lib/rankings-web"
import { createTRPCRouter, protectedProcedure } from "../init"

const yearSchema = z.number().int().min(2000).max(9999)
const weekSchema = z.number().int().min(1).max(53)
const monthSchema = z.number().int().min(1).max(12)

export const rankingsRouter = createTRPCRouter({
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

  risingStars: protectedProcedure
    .input(z.object({ year: yearSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const year = resolveYearInput(input)
      if (!year.ok) {
        throw new Error(year.error)
      }
      return buildRisingStarsForYear(ctx.db, year.value)
    }),
})
