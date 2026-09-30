import z from 'zod'
import { createTRPCRouter, publicProcedure } from '@/server/routers/trpc'
import { workflowRankingsDataAccess } from '.'

/**
 * Public ranking reads.
 *
 * These are deliberately unauthenticated: the ranking pages are marketing
 * surface, and the rows expose only already-public workflow metadata. Writes
 * happen exclusively through the cron routes, not through tRPC.
 */

const dimensionSchema = z.enum(['recent', 'popular'])
const periodSchema = z.enum(['daily', 'weekly', 'monthly'])

/** `YYYY-MM-DD`. A free-form string would be passed straight into a date equality. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')

export const workflowRankingsRouter = createTRPCRouter({
  /**
   * Top N for one period. Defaults to the latest computed snapshot.
   *
   * The limit is capped rather than caller-controlled: this backs the summary
   * lists on the ranking page, which only ever show a handful of rows.
   */
  getWorkflowRankings: publicProcedure
    .input(
      z.object({
        dimension: dimensionSchema,
        period: periodSchema,
        date: dateSchema.optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const rankings = await workflowRankingsDataAccess.getWorkflowRankings(input)
        return { success: true as const, data: rankings }
      } catch (error) {
        console.error('get workflow rankings failed:', error)
        return { success: false as const, error: '获取工作流排行失败', data: [] }
      }
    }),

  /** One workflow's rank movement across recent periods. */
  getWorkflowRankingHistory: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        dimension: dimensionSchema,
        period: periodSchema,
        limit: z.number().int().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      try {
        const history = await workflowRankingsDataAccess.getWorkflowRankingHistory(input)
        return { success: true as const, data: history }
      } catch (error) {
        console.error('get workflow ranking history failed:', error)
        return { success: false as const, error: '获取工作流排行历史失败', data: [] }
      }
    }),
})
