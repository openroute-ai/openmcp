import z from 'zod'
import { adminProcedure, createTRPCRouter } from '@/server/routers/trpc'
import { newsletterSubscriptionsDataAccess } from '.'

/**
 * Admin console access to newsletter subscribers.
 *
 * The upstream app exposed these seven procedures through `publicProcedure`,
 * which let anyone enumerate every address on the list and unsubscribe or edit
 * it. They are `adminProcedure` here, and the router is mounted under
 * `admin.newsletterSubscriptions`.
 */

const listSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  search: z.string().trim().max(128).optional(),
  userId: z.string().optional(),
  subscribed: z.boolean().optional(),
  source: z.string().trim().max(64).optional(),
})

const editableFields = {
  email: z.string().email().max(320),
  userId: z.string().nullable(),
  subscribed: z.boolean(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  utmTerm: z.string().nullable(),
  utmContent: z.string().nullable(),
  referrer: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  source: z.string().nullable(),
  lastEmailSentAt: z.date().nullable(),
  emailSentCount: z.number().int().min(0),
  // `subscribed_at` is NOT NULL in the schema, so it is not nullable here —
  // clearing it is not a state the column can hold.
  subscribedAt: z.date(),
  unsubscribedAt: z.date().nullable(),
}

export const adminNewsletterSubscriptionsRouter = createTRPCRouter({
  /** Paginated list with the linked user joined in. */
  getNewsletterSubscriptionsPaginated: adminProcedure.input(listSchema).query(async ({ input }) => {
    return newsletterSubscriptionsDataAccess.getPaginated(input.page, input.limit, {
      search: input.search,
      userId: input.userId,
      subscribed: input.subscribed,
      source: input.source,
    })
  }),

  getNewsletterSubscriptionById: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const subscription = await newsletterSubscriptionsDataAccess.getById(input.id)

      if (!subscription) {
        return { success: false as const, error: '订阅不存在', data: null }
      }

      return { success: true as const, data: subscription }
    }),

  getNewsletterSubscriptionByEmail: adminProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const subscription = await newsletterSubscriptionsDataAccess.getByEmail(input.email)

      if (!subscription) {
        return { success: false as const, error: '订阅不存在', data: null }
      }

      return { success: true as const, data: subscription }
    }),

  /**
   * Hand-added subscriber, e.g. an address imported from a list the app has
   * never seen. A duplicate address is rejected by the unique constraint.
   */
  createNewsletterSubscription: adminProcedure
    .input(z.object(editableFields).partial().required({ email: true }))
    .mutation(async ({ input }) => {
      const subscription = await newsletterSubscriptionsDataAccess.create(input)

      if (!subscription) {
        return { success: false as const, error: '创建订阅失败，邮箱可能已存在', data: null }
      }

      return { success: true as const, data: subscription }
    }),

  updateNewsletterSubscription: adminProcedure
    .input(z.object({ id: z.string(), ...editableFields }).partial().required({ id: true }))
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input
      const subscription = await newsletterSubscriptionsDataAccess.update(id, updateData)

      if (!subscription) {
        return { success: false as const, error: '更新订阅失败', data: null }
      }

      return { success: true as const, data: subscription }
    }),

  deleteNewsletterSubscription: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await newsletterSubscriptionsDataAccess.remove(input.id)

      if (!deleted) {
        return { success: false as const, error: '删除订阅失败' }
      }

      return { success: true as const }
    }),

  getNewsletterSubscriptionStats: adminProcedure.query(async () => {
    return newsletterSubscriptionsDataAccess.getStats()
  }),
})
