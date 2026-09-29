import { and, asc, count, desc, eq, gte, ilike, isNotNull, or, sql } from 'drizzle-orm'
import z from 'zod'
import { db } from '@/lib/db'
import { rechargeOrders, user } from '@workspace/db'
import { adminProcedure, createTRPCRouter } from '@/server/routers/trpc'

/**
 * Admin user management.
 *
 * Bans are written straight to the `user` table rather than through
 * `auth.api.banUser`. The target does not install better-auth's `admin`
 * plugin, so the server API is not available here; the columns the plugin
 * would have written (`banned`, `banReason`, `banExpires`) are already part of
 * the shared auth schema, and a session check reads `banned`/`banExpires`
 * regardless of who set them.
 *
 * Deleting a user is deliberately not offered: they own orders, balances and
 * marketplace rows, and there is no cascade policy that would not destroy
 * financial history. An admin can ban instead.
 */

/** Columns the console renders. `role` and the ban fields drive the actions. */
const userColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
  role: user.role,
  emailVerified: user.emailVerified,
  phoneNumber: user.phoneNumber,
  phoneNumberVerified: user.phoneNumberVerified,
  banned: user.banned,
  banReason: user.banReason,
  banExpires: user.banExpires,
  customerId: user.customerId,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
}

const listUsersSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().trim().max(64).optional(),
  role: z.enum(['all', 'user', 'admin']).default('all'),
  banned: z.boolean().optional(),
  /**
   * Single-column sort, mirroring the table headers. The source app took a
   * `sorting` array; only the first entry was ever honoured, so this keeps the
   * same behaviour with a shape that cannot silently disagree with itself.
   */
  sort: z.enum(['createdAt', 'name', 'email', 'role']).default('createdAt'),
  sortDesc: z.boolean().default(true),
})

export const adminUsersRouter = createTRPCRouter({
  /**
   * One user, for the detail page.
   *
   * Includes the wallet balance and order totals, because "what does this
   * account actually hold" is the question a support desk opens this page to
   * answer.
   */
  getUserById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [row] = await db.select(userColumns).from(user).where(eq(user.id, input.id)).limit(1)

    if (!row) {
      return { success: false as const, error: '用户不存在', data: null }
    }

    const [wallet, orders] = await Promise.all([
      db
        .select({ amount: sql<string>`coalesce(sum(${rechargeOrders.amount}), 0)`, count: count() })
        .from(rechargeOrders)
        .where(and(eq(rechargeOrders.userId, row.id), eq(rechargeOrders.status, 'paid'))),
      db
        .select({ count: count() })
        .from(rechargeOrders)
        .where(eq(rechargeOrders.userId, row.id)),
    ])

    return {
      success: true as const,
      data: {
        ...row,
        paidAmount: wallet[0]?.amount ?? '0',
        paidOrderCount: Number(wallet[0]?.count ?? 0),
        orderCount: Number(orders[0]?.count ?? 0),
      },
    }
  }),

  /**
   * Paginated, searchable, sortable user list.
   */
  listUsers: adminProcedure.input(listUsersSchema).query(async ({ input }) => {
    const { page, limit, search, role, banned, sort, sortDesc } = input

    const whereConditions = []

    if (search) {
      // Email and phone are both identifiers a support desk searches by.
      const needle = `%${search}%`
      whereConditions.push(
        or(ilike(user.name, needle), ilike(user.email, needle), ilike(user.phoneNumber, needle))!
      )
    }
    if (role !== 'all') {
      whereConditions.push(eq(user.role, role))
    }
    if (banned !== undefined) {
      whereConditions.push(eq(user.banned, banned))
    }

    const where = whereConditions.length > 0 ? and(...whereConditions) : undefined

    const orderByColumn = {
      createdAt: user.createdAt,
      name: user.name,
      email: user.email,
      role: user.role,
    }[sort]

    const orderBy = sortDesc ? desc(orderByColumn) : asc(orderByColumn)

    const [totalRow] = await db.select({ value: count() }).from(user).where(where)
    const total = totalRow?.value ?? 0

    const items = await db
      .select(userColumns)
      .from(user)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit)

    return {
      success: true as const,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }),

  /**
   * Header counters.
   *
   * "Active" is users with at least one settled order, not a stored flag: the
   * source app had faked it by reporting the total, which made the card
   * meaningless.
   */
  getUsersStats: adminProcedure.query(async () => {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const [totalRow, todayRow, paidUsersRow, todayRechargeRow, bannedRow] = await Promise.all([
      db.select({ value: count() }).from(user),
      db.select({ value: count() }).from(user).where(gte(user.createdAt, today)),
      db
        .select({ value: sql<number>`count(distinct ${rechargeOrders.userId})` })
        .from(rechargeOrders)
        .where(eq(rechargeOrders.status, 'paid')),
      db
        .select({ value: sql<number>`count(distinct ${rechargeOrders.userId})` })
        .from(rechargeOrders)
        .where(and(eq(rechargeOrders.status, 'paid'), isNotNull(rechargeOrders.paidAt), gte(rechargeOrders.paidAt, today))),
      db.select({ value: count() }).from(user).where(eq(user.banned, true)),
    ])

    return {
      success: true as const,
      data: {
        total: totalRow?.[0]?.value ?? 0,
        active: Number(paidUsersRow?.[0]?.value ?? 0),
        todayRegistered: todayRow?.[0]?.value ?? 0,
        todayRecharge: Number(todayRechargeRow?.[0]?.value ?? 0),
        rechargeUsers: Number(paidUsersRow?.[0]?.value ?? 0),
        banned: bannedRow?.[0]?.value ?? 0,
      },
    }
  }),

  /**
   * Ban a user.
   *
   * `banExpiresIn` is in seconds, matching better-auth's convention. An
   * omitted value means a permanent ban (`banExpires` stays null).
   */
  banUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        banReason: z.string().trim().min(1).max(500),
        banExpiresIn: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { userId, banReason, banExpiresIn } = input

      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)
      if (!existing) {
        return { success: false as const, error: '用户不存在' }
      }

      const banExpires = banExpiresIn ? new Date(Date.now() + banExpiresIn * 1000) : null

      const [updated] = await db
        .update(user)
        .set({ banned: true, banReason, banExpires, updatedAt: new Date() })
        .where(eq(user.id, userId))
        .returning(userColumns)

      return { success: true as const, data: updated }
    }),

  /**
   * Lift a ban.
   *
   * Clears the reason and expiry along with the flag: leaving them behind
   * would make a later audit read as if the user were still banned.
   */
  unbanUser: adminProcedure.input(z.object({ userId: z.string() })).mutation(async ({ input }) => {
    const [updated] = await db
      .update(user)
      .set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() })
      .where(eq(user.id, input.userId))
      .returning(userColumns)

    if (!updated) {
      return { success: false as const, error: '用户不存在' }
    }
    return { success: true as const, data: updated }
  }),

  /**
   * Change a user's platform role.
   *
   * Guarded against an admin demoting themselves: the console has no other
   * admin view, so a self-demotion locks everyone out of this namespace until
   * someone edits the row by hand.
   */
  updateUserRole: adminProcedure
    .input(z.object({ userId: z.string(), role: z.enum(['user', 'admin']) }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id && input.role !== 'admin') {
        return { success: false as const, error: '不能取消自己的管理员权限' }
      }

      const [updated] = await db
        .update(user)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(user.id, input.userId))
        .returning(userColumns)

      if (!updated) {
        return { success: false as const, error: '用户不存在' }
      }
      return { success: true as const, data: updated }
    }),
})
