import { and, asc, gte } from "drizzle-orm"
import { z } from "zod"
import { traffic } from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

const RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
} as const

export const trafficRouter = createTRPCRouter({
  series: protectedProcedure
    .input(
      z.object({ range: z.enum(["7d", "30d", "90d", "12m"]).default("30d") })
    )
    .query(async ({ ctx, input }) => {
      const days = RANGE_DAYS[input.range]
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      from.setDate(from.getDate() - (days - 1))

      const rows = await ctx.db
        .select({
          day: traffic.day,
          desktop: traffic.desktop,
          mobile: traffic.mobile,
        })
        .from(traffic)
        .where(and(gte(traffic.day, from.toISOString().slice(0, 10))))
        .orderBy(asc(traffic.day))

      return rows.map((row) => ({
        date: row.day,
        desktop: row.desktop,
        mobile: row.mobile,
      }))
    }),
})
