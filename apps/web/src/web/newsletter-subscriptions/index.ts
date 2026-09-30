import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { createId, newsletterSubscription, user } from '@workspace/db'
import { db } from '@/lib/db'

/**
 * Admin-side access to `newsletter_subscription`.
 *
 * The end-user side lives in `@/web/newsletter/router` and only ever needs to
 * read or flip its own `subscribed` flag. Everything here exists for the admin
 * console: browsing, filtering, hand-editing and auditing the list.
 *
 * Errors are swallowed and reported as `success: false` rather than thrown,
 * because the admin console renders a degraded table with a toast instead of an
 * error boundary. Mutating calls therefore return `null`/`false` on failure and
 * the router turns that into a result envelope.
 */

export type NewsletterSubscriptionRow = typeof newsletterSubscription.$inferSelect

export type NewsletterSubscriptionWithUser = NewsletterSubscriptionRow & {
  user: Pick<typeof user.$inferSelect, 'id' | 'name' | 'email' | 'image'> | null
}

/**
 * Columns an admin may write.
 *
 * Nullable columns are typed `| null` because the table genuinely allows them.
 * `subscribed`, `emailSentCount` and `subscribedAt` are `NOT NULL` with defaults,
 * so they are optional but not nullable — declaring them nullable would let a
 * caller send an explicit `null` that Postgres rejects.
 */
export type CreateNewsletterSubscription = {
  email: string
  userId?: string | null
  subscribed?: boolean
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
  referrer?: string | null
  userAgent?: string | null
  ipAddress?: string | null
  source?: string | null
  lastEmailSentAt?: Date | null
  emailSentCount?: number
  subscribedAt?: Date
  unsubscribedAt?: Date | null
}

export type UpdateNewsletterSubscription = Partial<CreateNewsletterSubscription>

/** Columns joined from `user` for display; never expose the full user row. */
const userColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
}

export type NewsletterSubscriptionFilters = {
  search?: string
  userId?: string
  subscribed?: boolean
  source?: string
}

const emptyStats = {
  total: 0,
  subscribed: 0,
  unsubscribed: 0,
  website: 0,
  api: 0,
  import: 0,
  totalEmailsSent: 0,
}

function buildWhere(filters: NewsletterSubscriptionFilters) {
  const conditions = []

  if (filters.search) {
    const term = `%${filters.search}%`
    conditions.push(
      or(
        ilike(newsletterSubscription.email, term),
        ilike(newsletterSubscription.utmSource, term),
        ilike(newsletterSubscription.utmCampaign, term)
      )
    )
  }

  if (filters.userId) {
    conditions.push(eq(newsletterSubscription.userId, filters.userId))
  }

  if (filters.subscribed !== undefined) {
    conditions.push(eq(newsletterSubscription.subscribed, filters.subscribed))
  }

  if (filters.source) {
    conditions.push(eq(newsletterSubscription.source, filters.source))
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

export const newsletterSubscriptionsDataAccess = {
  /**
   * Paginated list, newest first, with the linked user joined in.
   */
  async getPaginated(page: number, limit: number, filters: NewsletterSubscriptionFilters = {}) {
    try {
      const whereClause = buildWhere(filters)

      const [totalResult] = await db
        .select({ value: count() })
        .from(newsletterSubscription)
        .where(whereClause)

      const total = totalResult?.value ?? 0

      const rows = await db
        .select({ subscription: newsletterSubscription, user: userColumns })
        .from(newsletterSubscription)
        .leftJoin(user, eq(newsletterSubscription.userId, user.id))
        .where(whereClause)
        .orderBy(desc(newsletterSubscription.createdAt))
        .limit(limit)
        .offset((page - 1) * limit)

      return {
        success: true as const,
        data: rows.map((row) => ({ ...row.subscription, user: row.user })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    } catch (error) {
      console.error('get newsletter subscriptions failed:', error)
      return {
        success: false as const,
        error: '获取订阅列表失败',
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      }
    }
  },

  async getById(id: string): Promise<NewsletterSubscriptionWithUser | null> {
    try {
      const [row] = await db
        .select({ subscription: newsletterSubscription, user: userColumns })
        .from(newsletterSubscription)
        .leftJoin(user, eq(newsletterSubscription.userId, user.id))
        .where(eq(newsletterSubscription.id, id))
        .limit(1)

      if (!row) return null
      return { ...row.subscription, user: row.user }
    } catch (error) {
      console.error('get newsletter subscription by id failed:', error)
      return null
    }
  },

  async getByEmail(email: string): Promise<NewsletterSubscriptionWithUser | null> {
    try {
      const [row] = await db
        .select({ subscription: newsletterSubscription, user: userColumns })
        .from(newsletterSubscription)
        .leftJoin(user, eq(newsletterSubscription.userId, user.id))
        .where(eq(newsletterSubscription.email, email))
        .limit(1)

      if (!row) return null
      return { ...row.subscription, user: row.user }
    } catch (error) {
      console.error('get newsletter subscription by email failed:', error)
      return null
    }
  },

  /**
   * `email` is unique, so a duplicate is an expected rejection rather than a
   * bug; the router surfaces it as "already subscribed".
   */
  async create(data: CreateNewsletterSubscription): Promise<NewsletterSubscriptionRow | null> {
    try {
      const [created] = await db
        .insert(newsletterSubscription)
        .values({
          id: createId(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      return created ?? null
    } catch (error) {
      console.error('create newsletter subscription failed:', error)
      return null
    }
  },

  async update(id: string, data: UpdateNewsletterSubscription): Promise<NewsletterSubscriptionRow | null> {
    try {
      const [updated] = await db
        .update(newsletterSubscription)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(newsletterSubscription.id, id))
        .returning()

      return updated ?? null
    } catch (error) {
      console.error('update newsletter subscription failed:', error)
      return null
    }
  },

  async remove(id: string): Promise<boolean> {
    try {
      await db.delete(newsletterSubscription).where(eq(newsletterSubscription.id, id))
      return true
    } catch (error) {
      console.error('delete newsletter subscription failed:', error)
      return false
    }
  },

  /**
   * Headline counters for the console cards. `source` buckets mirror the three
   * origins the app records ('website' | 'api' | 'import'); anything else is
   * counted in `total` only.
   */
  async getStats() {
    try {
      const [stats] = await db
        .select({
          total: sql<number>`count(*)`,
          subscribed: sql<number>`count(*) filter (where subscribed = true)`,
          unsubscribed: sql<number>`count(*) filter (where subscribed = false)`,
          website: sql<number>`count(*) filter (where source = 'website')`,
          api: sql<number>`count(*) filter (where source = 'api')`,
          import: sql<number>`count(*) filter (where source = 'import')`,
          totalEmailsSent: sql<number>`coalesce(sum(email_sent_count), 0)`,
        })
        .from(newsletterSubscription)

      return { success: true as const, data: stats }
    } catch (error) {
      console.error('get newsletter subscription stats failed:', error)
      return { success: false as const, error: '获取订阅统计失败', data: emptyStats }
    }
  },
}
