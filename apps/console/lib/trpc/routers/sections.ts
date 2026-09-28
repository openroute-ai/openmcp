import { asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { sections } from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

const reorderSchema = z.object({
  items: z
    .array(z.object({ id: z.number().int(), position: z.number().int() }))
    .min(1),
})

export const sectionsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["In Process", "Done", "Cancled", "Rejected"])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: sections.id,
          header: sections.header,
          type: sections.type,
          status: sections.status,
          target: sections.target,
          limit: sections.limit,
          reviewer: sections.reviewer,
          position: sections.position,
        })
        .from(sections)
        .where(input.status ? eq(sections.status, input.status) : undefined)
        .orderBy(asc(sections.position), asc(sections.id))
        .limit(input.limit)

      return rows
    }),

  reorder: protectedProcedure
    .input(reorderSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (const item of input.items) {
          await tx
            .update(sections)
            .set({ position: item.position, updatedAt: new Date() })
            .where(eq(sections.id, item.id))
        }
      })

      return { updated: input.items.length }
    }),

  countsByStatus: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        status: sections.status,
        count: sql<number>`count(*)::int`,
      })
      .from(sections)
      .groupBy(sections.status)

    return Object.fromEntries(rows.map((r) => [r.status, r.count])) as Record<
      string,
      number
    >
  }),
})
