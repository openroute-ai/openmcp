import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { rechargeOrders, user, type RechargeOrderStatus, type RechargeOrderType } from '@workspace/db'
import { db } from '@/lib/db'
import { adminProcedure, createTRPCRouter } from '@/server/routers/trpc'
import { settleRechargeOrder } from './settle'

/**
 * Order-level admin console for recharge orders.
 *
 * Separate from the bank-transfer reconciliation router (`admin.recharge`):
 * that one answers "did the money arrive", this one answers "what orders exist
 * and what state are they in". Offline sales, support-desk top-ups and gateway
 * orders all land in the same table, so a voucher-centric view is not enough.
 *
 * Money invariants:
 *
 *  1. Creating an order never credits a wallet. Crediting goes through
 *     `settleRechargeOrder`, the idempotent path the gateway webhooks use.
 *  2. A `paid` order is terminal: its balance was already settled, so it can
 *     never be walked back to `pending` or `closed`.
 */

/**
 * The status vocabulary is the DB's, not the source app's. Notably the target
 * has no `cancelled` — a voided order is `closed` — and `pending_transfer` is
 * where a bank transfer parks until an admin reconciles it.
 */
const ORDER_STATUSES = [
  'pending',
  'pending_transfer',
  'paid',
  'expired',
  'closed',
  'failed',
] as const satisfies readonly RechargeOrderStatus[]

const orderStatusSchema = z.enum(ORDER_STATUSES)

/**
 * Payment methods the target actually writes.
 *
 * Mirrors `RechargeOrderType` because `paymentMethod` and `type` are kept in
 * lockstep for admin-created orders — `gifted` exists only as a display label
 * on the bills table and is not a storable order type.
 */
const PAYMENT_METHODS = ['alipay', 'wechat', 'bank_transfer', 'recharge'] as const satisfies readonly RechargeOrderType[]

const orderSchema = z.object({
  orderId: z.string().min(1).max(64),
  userId: z.string().min(1),
  /** Decimal string, e.g. `"100.00"`. The DB column is numeric(10,2). */
  amount: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, '金额格式不正确'),
  /** Wallet credit granted on settlement. Defaults to 1:1 with `amount`. */
  credits: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, '积分格式不正确')
    .optional(),
  currency: z.string().length(3).default('CNY'),
  paymentMethod: z.enum(PAYMENT_METHODS).default('alipay'),
  status: orderStatusSchema.default('pending'),
  thirdPartyOrderId: z.string().trim().max(128).optional(),
  expiresAt: z.coerce.date(),
  paidAt: z.coerce.date().optional(),
  remark: z.string().trim().max(500).optional(),
  ip: z.string().trim().max(64).optional(),
  userAgent: z.string().trim().max(500).optional(),
})

/** Columns the console table renders, joined with the buyer for display. */
const orderColumns = {
  id: rechargeOrders.id,
  orderId: rechargeOrders.orderId,
  userId: rechargeOrders.userId,
  amount: rechargeOrders.amount,
  credits: rechargeOrders.credits,
  currency: rechargeOrders.currency,
  paymentMethod: rechargeOrders.paymentMethod,
  status: rechargeOrders.status,
  type: rechargeOrders.type,
  thirdPartyOrderId: rechargeOrders.thirdPartyOrderId,
  remark: rechargeOrders.remark,
  createdAt: rechargeOrders.createdAt,
  updatedAt: rechargeOrders.updatedAt,
  expiresAt: rechargeOrders.expiresAt,
  paidAt: rechargeOrders.paidAt,
}

const listInput = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  search: z.string().trim().max(64).optional(),
  userId: z.string().optional(),
  status: orderStatusSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
})

export const adminRechargeOrdersRouter = createTRPCRouter({
  /**
   * Paginated order list.
   *
   * `paymentMethod`/`status` are enums rather than free strings so a filter can
   * never widen into a full-table scan on an unindexed column.
   */
  getRechargeOrdersPaginated: adminProcedure.input(listInput).query(async ({ input }) => {
    const { page, limit, search, userId, status, paymentMethod } = input
    const conditions = []

    if (search) {
      // `orderId` is the human-facing handle, `thirdPartyOrderId` the gateway's.
      const needle = `%${search}%`
      conditions.push(
        or(
          ilike(rechargeOrders.orderId, needle),
          ilike(rechargeOrders.thirdPartyOrderId, needle)
        )
      )
    }
    if (userId) conditions.push(eq(rechargeOrders.userId, userId))
    if (status) conditions.push(eq(rechargeOrders.status, status))
    if (paymentMethod) conditions.push(eq(rechargeOrders.paymentMethod, paymentMethod))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [row] = await db.select({ value: count() }).from(rechargeOrders).where(where)
    const total = row?.value ?? 0

    const orders =
      total === 0
        ? []
        : await db
            .select({ ...orderColumns, userName: user.name, userEmail: user.email })
            .from(rechargeOrders)
            .leftJoin(user, eq(user.id, rechargeOrders.userId))
            .where(where)
            .orderBy(desc(rechargeOrders.createdAt))
            .limit(limit)
            .offset((page - 1) * limit)

    return {
      success: true as const,
      data: orders.map((order) => ({
        ...order,
        amount: order.amount.toString(),
        credits: order.credits.toString(),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  }),

  /** Header counters and money totals for the console. */
  getRechargeOrderStats: adminProcedure.query(async () => {
    const [stats] = await db
      .select({
        total: sql<number>`count(*)`,
        pending: sql<number>`count(*) filter (where status in ('pending','pending_transfer'))`,
        paid: sql<number>`count(*) filter (where status = 'paid')`,
        failed: sql<number>`count(*) filter (where status = 'failed')`,
        expired: sql<number>`count(*) filter (where status = 'expired')`,
        closed: sql<number>`count(*) filter (where status = 'closed')`,
        totalAmount: sql<string>`coalesce(sum(amount), 0)`,
        paidAmount: sql<string>`coalesce(sum(amount) filter (where status = 'paid'), 0)`,
        pendingAmount: sql<string>`coalesce(sum(amount) filter (where status in ('pending','pending_transfer')), 0)`,
      })
      .from(rechargeOrders)

    return { success: true as const, data: stats }
  }),

  /**
   * Create an order on an admin's behalf (offline sale, migration, support).
   *
   * Does not credit the wallet — an order created as `pending` is a record, not
   * a payment. Crediting happens when the order transitions to `paid` through
   * `updateRechargeOrder`, which routes into the idempotent settle path.
   */
  createRechargeOrder: adminProcedure.input(orderSchema).mutation(async ({ input }) => {
    // A user FK violation here is the common case (typo'd id), so surface it as
    // a validation error instead of a 500.
    const [owner] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!owner) {
      return { success: false as const, error: '用户不存在', data: null }
    }

    const [existing] = await db
      .select({ id: rechargeOrders.id })
      .from(rechargeOrders)
      .where(eq(rechargeOrders.orderId, input.orderId))
      .limit(1)
    if (existing) {
      return { success: false as const, error: '订单号已存在', data: null }
    }

    const [order] = await db
      .insert(rechargeOrders)
      .values({
        orderId: input.orderId,
        userId: input.userId,
        amount: input.amount,
        // Wallet credit is 1:1 with money paid in unless an override is given.
        credits: input.credits ?? input.amount,
        currency: input.currency,
        paymentMethod: input.paymentMethod,
        type: input.paymentMethod,
        status: input.status,
        thirdPartyOrderId: input.thirdPartyOrderId ?? null,
        expiresAt: input.expiresAt,
        paidAt: input.paidAt ?? null,
        remark: input.remark ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning()

    if (!order) {
      return { success: false as const, error: '创建充值订单失败', data: null }
    }
    return { success: true as const, data: order }
  }),

  /**
   * Status and remark edits.
   *
   * Moving an order *to* `paid` credits the wallet via `settleRechargeOrder`, so
   * an admin marking an offline payment as received produces the same balance
   * movement as a gateway callback. `paid` is then frozen.
   */
  updateRechargeOrder: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        status: orderStatusSchema.optional(),
        remark: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select({ orderId: rechargeOrders.orderId, status: rechargeOrders.status })
        .from(rechargeOrders)
        .where(eq(rechargeOrders.id, input.id))
        .limit(1)

      if (!existing) {
        return { success: false as const, error: '充值订单不存在', data: null }
      }
      if (existing.status === 'paid' && input.status && input.status !== 'paid') {
        return { success: false as const, error: '已支付订单不能回退状态', data: null }
      }

      // Marking paid must move money, so the settlement is the primary effect
      // and the status row is only the record of it. Settling first means a
      // failure leaves the order un-paid and visible, rather than `paid` with an
      // uncredited wallet. `settleRechargeOrder` is idempotent, and it also
      // writes `status`/`paidAt`, so the update below is a no-op for those
      // columns on this path.
      if (input.status === 'paid' && existing.status !== 'paid') {
        const settlement = await settleRechargeOrder({
          orderId: existing.orderId,
          reason: 'admin_marked_paid',
          // The operator is attesting the money arrived; a stale `expiresAt`
          // must not strand the credit.
          allowExpired: true,
        })

        if (!settlement.ok) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: settlement.error })
        }
      }

      const [order] = await db
        .update(rechargeOrders)
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.remark !== undefined ? { remark: input.remark } : {}),
          updatedAt: new Date(),
        })
        .where(eq(rechargeOrders.id, input.id))
        .returning()

      if (!order) {
        return { success: false as const, error: '更新充值订单失败', data: null }
      }
      return { success: true as const, data: order }
    }),
})
