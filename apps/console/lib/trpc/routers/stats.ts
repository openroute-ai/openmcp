import { sql } from "drizzle-orm"
import { sections } from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

export const statsRouter = createTRPCRouter({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        inProcess: sql<number>`count(*) filter (where ${sections.status} = 'In Process')::int`,
        done: sql<number>`count(*) filter (where ${sections.status} = 'Done')::int`,
        canceled: sql<number>`count(*) filter (where ${sections.status} = 'Cancled')::int`,
        rejected: sql<number>`count(*) filter (where ${sections.status} = 'Rejected')::int`,
        reviewers: sql<number>`count(distinct ${sections.reviewer})::int`,
        targetSum: sql<number>`coalesce(sum(${sections.target}), 0)::int`,
        limitSum: sql<number>`coalesce(sum(${sections.limit}), 0)::int`,
      })
      .from(sections)

    const total = row?.total ?? 0
    const done = row?.done ?? 0

    return {
      total,
      inProcess: row?.inProcess ?? 0,
      done,
      canceled: row?.canceled ?? 0,
      rejected: row?.rejected ?? 0,
      reviewers: row?.reviewers ?? 0,
      targetSum: row?.targetSum ?? 0,
      limitSum: row?.limitSum ?? 0,
      completionRate: total === 0 ? 0 : Math.round((done / total) * 1000) / 10,
    }
  }),
})
