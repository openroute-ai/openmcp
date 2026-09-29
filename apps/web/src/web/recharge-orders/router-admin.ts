import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { bankTransferVouchers, rechargeOrders } from '@workspace/db'
import { adminProcedure, createTRPCRouter } from '@/server/routers/trpc'
import { getRechargeOrderByOrderId, listVouchersForAdmin, markVoucherReviewed } from './index'
import { settleRechargeOrder } from './settle'

/**
 * Admin reconciliation for 对公转账 (bank transfer).
 *
 * A bank transfer produces no gateway callback, so a human confirms it. Two
 * invariants keep that from becoming a money hole:
 *
 *  1. The voucher must still be `pending` to be actioned — enforced in SQL, so
 *     a double click or two concurrent admins cannot both confirm.
 *  2. Crediting goes through `settleRechargeOrder`, the same idempotent path the
 *     WeChat/Alipay webhook uses. The order-level `status <> 'paid'` guard is
 *     the real backstop: even if a voucher were actioned twice, the balance
 *     moves at most once.
 */
export const adminRechargeRouter = createTRPCRouter({
  /** Paginated voucher list for the reconciliation screen. */
  listVouchers: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        status: z.enum(['all', 'pending', 'confirmed', 'rejected']).default('all'),
        search: z.string().trim().max(64).optional(),
      })
    )
    .query(async ({ input }) => {
      const { page, limit, status, search } = input
      const result = await listVouchersForAdmin({
        status,
        search: search || undefined,
        limit,
        offset: (page - 1) * limit,
      })

      // Join the order so the console can show method + expiry alongside the code.
      const items = await db
        .select({
          id: bankTransferVouchers.id,
          orderId: bankTransferVouchers.orderId,
          remittanceCode: bankTransferVouchers.remittanceCode,
          userId: bankTransferVouchers.userId,
          amount: bankTransferVouchers.amount,
          payerName: bankTransferVouchers.payerName,
          status: bankTransferVouchers.status,
          reviewedBy: bankTransferVouchers.reviewedBy,
          reviewedAt: bankTransferVouchers.reviewedAt,
          rejectReason: bankTransferVouchers.rejectReason,
          createdAt: bankTransferVouchers.createdAt,
          userName: rechargeOrders.type,
        })
        .from(bankTransferVouchers)
        .leftJoin(rechargeOrders, eq(rechargeOrders.orderId, bankTransferVouchers.orderId))
        .where(
          status === 'all'
            ? undefined
            : eq(bankTransferVouchers.status, status)
        )
        .orderBy(desc(bankTransferVouchers.createdAt))
        .limit(limit)
        .offset((page - 1) * limit)

      return {
        success: true as const,
        data: {
          items: items.map((row) => ({
            ...row,
            amount: row.amount.toString(),
          })),
          total: result.total,
          page,
          limit,
        },
      }
    }),

  /** Confirm a transfer against the bank statement and credit the wallet. */
  confirmVoucher: adminProcedure
    .input(z.object({ orderId: z.string(), payerName: z.string().trim().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await getRechargeOrderByOrderId(input.orderId)
      if (!order || order.type !== 'bank_transfer') {
        throw new TRPCError({ code: 'NOT_FOUND', message: '转账订单不存在' })
      }

      const voucher = await markVoucherReviewed({
        orderId: input.orderId,
        status: 'confirmed',
        reviewedBy: ctx.user.id,
      })
      // Null means the row was not `pending` — already actioned by someone else.
      if (!voucher) {
        return { success: false as const, error: '该凭证已被处理' }
      }

      const settlement = await settleRechargeOrder({
        orderId: input.orderId,
        reason: 'bank_transfer_confirmed',
        // Bank transfers are credited at the order amount; there is no
        // signed gateway figure to cross-check against.
      })

      if (!settlement.ok) {
        // Keep the voucher marked confirmed but leave the order unpaid, so the
        // discrepancy stays visible in the console instead of vanishing.
        console.error('[bank-transfer] settle failed after confirm', settlement)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: settlement.error })
      }

      return {
        success: true as const,
        data: {
          orderId: settlement.orderId,
          amount: settlement.amount,
          balanceAfter: settlement.balanceAfter,
          alreadySettled: settlement.alreadySettled,
        },
      }
    }),

  /** Reject a transfer the admin could not match to a bank statement. */
  rejectVoucher: adminProcedure
    .input(z.object({ orderId: z.string(), reason: z.string().trim().max(200) }))
    .mutation(async ({ input }) => {
      const voucher = await markVoucherReviewed({
        orderId: input.orderId,
        status: 'rejected',
        reviewedBy: '',
        rejectReason: input.reason,
      })
      if (!voucher) return { success: false as const, error: '该凭证已被处理' }

      const [order] = await db
        .update(rechargeOrders)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(
          and(
            eq(rechargeOrders.orderId, input.orderId),
            sql`${rechargeOrders.status} <> 'paid'`
          )
        )
        .returning()
      if (!order) return { success: false as const, error: '该订单已被处理' }

      return { success: true as const }
    }),
})
