import { TRPCError } from '@trpc/server'
import z from 'zod'
import { SITE_MESSAGE_DEFAULT_PAGE_SIZE, siteMessagesDataAccess } from '@/lib/site-messages'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'

/**
 * The notification bell in the dashboard header.
 *
 * Five procedures, all scoped to `ctx.user.id`. `getById` and `markRead` fail
 * with NOT_FOUND rather than returning null so a guessed id is
 * indistinguishable from a deleted one.
 */

const listInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(SITE_MESSAGE_DEFAULT_PAGE_SIZE),
  readFilter: z.enum(['all', 'unread', 'read']).default('all'),
})

export const siteMessagesRouter = createTRPCRouter({
  list: protectedProcedure.input(listInputSchema).query(async ({ ctx, input }) => {
    return siteMessagesDataAccess.list({
      userId: ctx.user.id,
      page: input.page,
      pageSize: input.pageSize,
      readFilter: input.readFilter,
    })
  }),

  /** Drives the badge, so it is polled rather than pushed. */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return {
      count: await siteMessagesDataAccess.getUnreadCount(ctx.user.id),
      // The client polls this query, and the list renders relative timestamps
      // against a single clock reading. Returning the server's time with the
      // count gives the UI a stable reference that advances with each poll
      // instead of reading the browser clock during render.
      polledAt: Date.now(),
    }
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const message = await siteMessagesDataAccess.getById(ctx.user.id, input.id)

      if (!message) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '消息不存在或无权访问' })
      }

      return message
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await siteMessagesDataAccess.markRead(ctx.user.id, input.id)

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '消息不存在或无权访问' })
      }

      return { success: true as const }
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    return { updatedCount: await siteMessagesDataAccess.markAllRead(ctx.user.id) }
  }),
})
