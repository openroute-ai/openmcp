import { and, count, desc, eq, gte, gt, ilike, or, sql } from 'drizzle-orm'
import z from 'zod'
import { db } from '@/lib/db'
import { session, user } from '@workspace/db'
import { adminProcedure, createTRPCRouter } from '@/server/routers/trpc'

/**
 * Admin session inspection and revocation.
 *
 * Reads the same `session` table better-auth writes, so revoking here takes
 * effect on the user's next request without needing the admin plugin's
 * `revokeSession` endpoint. There is no un-revoke: a revoked row is deleted,
 * and the user signs in again.
 */

/**
 * Session columns safe to return to the browser.
 *
 * `session.token` is the bearer credential: whoever holds it is the user, so it
 * is deliberately absent. An admin investigating a hijacked account needs the id,
 * IP, UA and timing to correlate it, and can revoke by id without ever seeing
 * the token.
 */
const sessionColumns = {
  id: session.id,
  userId: session.userId,
  ipAddress: session.ipAddress,
  userAgent: session.userAgent,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  expiresAt: session.expiresAt,
}

const listSessionsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  search: z.string().trim().max(64).optional(),
  userId: z.string().optional(),
  /** `active` is derived from `expiresAt`, not stored. */
  active: z.boolean().optional(),
})

export const adminSessionsRouter = createTRPCRouter({
  /** One session, for the detail page. */
  getSessionById: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const [row] = await db
      .select({
        ...sessionColumns,
        userName: user.name,
        userEmail: user.email,
      })
      .from(session)
      .leftJoin(user, eq(session.userId, user.id))
      .where(eq(session.id, input.id))
      .limit(1)

    if (!row) {
      return { success: false as const, error: '会话不存在', data: null }
    }

    return {
      success: true as const,
      data: { ...row, active: row.expiresAt.getTime() > Date.now() },
    }
  }),

  /** Paginated session list. See `sessionColumns` for why the token is absent. */
  getSessions: adminProcedure.input(listSessionsSchema).query(async ({ input }) => {
    const { page, limit, search, userId, active } = input

    const whereConditions = []

    if (search) {
      // Match the owner's name, email, IP or UA: an admin usually has one of
      // these from a support ticket, not the session id.
      const needle = `%${search}%`
      whereConditions.push(
        or(
          ilike(user.name, needle),
          ilike(user.email, needle),
          ilike(session.ipAddress, needle),
          ilike(session.userAgent, needle)
        )!
      )
    }
    if (userId) {
      whereConditions.push(eq(session.userId, userId))
    }
    if (active === true) {
      whereConditions.push(gt(session.expiresAt, new Date()))
    } else if (active === false) {
      whereConditions.push(sql`${session.expiresAt} <= now()`)
    }

    const where = whereConditions.length > 0 ? and(...whereConditions) : undefined

    const [totalRow] = await db
      .select({ value: count() })
      .from(session)
      .leftJoin(user, eq(session.userId, user.id))
      .where(where)
    const total = totalRow?.value ?? 0

    const now = new Date()
    const rows = await db
      .select({
        id: session.id,
        userId: session.userId,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(session)
      .leftJoin(user, eq(session.userId, user.id))
      .where(where)
      .orderBy(desc(session.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return {
      success: true as const,
      data: rows.map((row) => ({ ...row, active: row.expiresAt.getTime() > now.getTime() })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  }),

  /** Every session belonging to one user, for the user detail page. */
  getSessionsByUserId: adminProcedure
    .input(z.object({ userId: z.string(), limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const now = new Date()
      const rows = await db
        .select({
          id: session.id,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })
        .from(session)
        .where(eq(session.userId, input.userId))
        .orderBy(desc(session.createdAt))
        .limit(input.limit)

      return {
        success: true as const,
        data: rows.map((row) => ({ ...row, active: row.expiresAt.getTime() > now.getTime() })),
      }
    }),

  /**
   * Header counters.
   *
   * Counted in SQL. The source app loaded up to 1000 sessions into memory to
   * compute "today", which silently under-counted on any busier instance.
   */
  getSessionsStats: adminProcedure.query(async () => {
    const now = new Date()
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const [totalRow, activeRow, expiredRow, todayRow] = await Promise.all([
      db.select({ value: count() }).from(session),
      db.select({ value: count() }).from(session).where(sql`${session.expiresAt} > now()`),
      db.select({ value: count() }).from(session).where(sql`${session.expiresAt} <= now()`),
      db.select({ value: count() }).from(session).where(gte(session.createdAt, today)),
    ])

    return {
      success: true as const,
      data: {
        total: totalRow?.[0]?.value ?? 0,
        active: activeRow?.[0]?.value ?? 0,
        expired: expiredRow?.[0]?.value ?? 0,
        today: todayRow?.[0]?.value ?? 0,
        // Surfaced so the console can explain the gap between `total` and
        // `active + expired` rather than the numbers looking inconsistent.
        evaluatedAt: now.toISOString(),
      },
    }
  }),

  /**
   * Extend or shorten a session's lifetime.
   *
   * The source app also let an admin rewrite `ipAddress` and `userAgent` here.
   * Those two columns are the record used to work out whether a session was
   * stolen, so overwriting them with whatever was typed would destroy the only
   * evidence the console exists to surface. Only `expiresAt` is editable, which
   * is the genuinely useful support action.
   */
  updateSession: adminProcedure
    .input(
      z.object({
        id: z.string(),
        /** ISO string. Must be a parseable date. */
        expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
          message: '过期时间格式无效',
        }),
      })
    )
    .mutation(async ({ input }) => {
      const expiresAt = new Date(input.expiresAt)

      const [updated] = await db
        .update(session)
        .set({ expiresAt, updatedAt: new Date() })
        .where(eq(session.id, input.id))
        .returning(sessionColumns)

      if (!updated) {
        return { success: false as const, error: '会话不存在' }
      }
      return { success: true as const, data: { ...updated, active: expiresAt.getTime() > Date.now() } }
    }),

  /**
   * Revoke a session (delete the row).
   *
   * Idempotent from the caller's perspective: revoking an already-gone session
   * reports the same success, because the desired end state is "not signed in
   * on this session" either way.
   */
  deleteSession: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const deleted = await db.delete(session).where(eq(session.id, input.id)).returning({ id: session.id })

    return {
      success: true as const,
      data: { id: input.id, deleted: deleted.length > 0 },
    }
  }),

  /**
   * Revoke every session for a user.
   *
   * The response for a "sign out everywhere" / incident-containment action.
   * An admin's own sessions are included; there is no way to exempt the
   * caller, because locking yourself out is recoverable by an admin and a
   * half-revoked compromise is not.
   */
  deleteSessionsByUserId: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await db
        .delete(session)
        .where(eq(session.userId, input.userId))
        .returning({ id: session.id })

      return { success: true as const, data: { userId: input.userId, revoked: deleted.length } }
    }),
})
