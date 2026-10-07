import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { rechargeOrders, user } from '@workspace/db'
import { db } from '@/lib/db'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'
import { isSimulationMode, getTopUpGateway, resolveOnlineChannel } from '@/server/payment/gateway'
import { getOrCreateBalance } from './balance'
import {
  createBankTransferVoucher,
  createRechargeOrder,
  expireStaleOrders,
  getRechargeOrderByOrderId,
  getVoucherByOrderId,
  listRechargeOrdersByUser,
} from './index'
import { websiteConfig } from '@/lib/config/website'

/**
 * Server-side amount policy.
 *
 * The client sends a chosen amount, but the accepted set and the resulting
 * credit are both computed here. A tampered request can therefore only ever
 * pick a value from this list — it cannot invent a price, a currency, or a
 * credit multiplier.
 */
const MIN_AMOUNT = 1
const MAX_AMOUNT = 50000
const ALLOWED_AMOUNTS = [10, 50, 100, 200, 500, 1000, 2000] as const

/** Wallet credit is 1:1 with money paid in; kept explicit for future promos. */
const CREDIT_RATE = 1

const amountSchema = z
  .number()
  .refine((v) => Number.isInteger(v), '充值金额必须为整数')
  .refine((v) => v >= MIN_AMOUNT && v <= MAX_AMOUNT, {
    message: `充值金额需在 ${MIN_AMOUNT} - ${MAX_AMOUNT} 之间`,
  })
  .refine((v) => (ALLOWED_AMOUNTS as readonly number[]).includes(v), {
    message: '不支持的充值金额档位',
  })

const onlineSchema = z.object({ amount: amountSchema })
const bankSchema = z.object({
  amount: amountSchema,
  /** Account holder name on the incoming transfer; helps an admin match it. */
  payerName: z.string().trim().max(64).optional(),
})

const orderView = (order: {
  orderId: string
  amount: string
  credits: string
  currency: string
  status: string
  paymentMethod: string
  type: string
  qrCode: string | null
  paymentUrl: string | null
  createdAt: Date
  expiresAt: Date
  paidAt: Date | null
}) => ({
  orderId: order.orderId,
  amount: order.amount,
  credits: order.credits,
  currency: order.currency,
  status: order.status,
  paymentMethod: order.paymentMethod,
  type: order.type,
  createdAt: order.createdAt,
  expiresAt: order.expiresAt,
  paidAt: order.paidAt,
})

/**
 * Display labels for the bills table.
 *
 * The stored `payment_method` / `status` values are provider and workflow
 * vocabulary; the table shows a human-readable name. Unknown values pass
 * through unchanged so a newly added channel is still legible rather than
 * blank.
 */
const BILL_CHANNEL_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
  bank: '银行卡',
  bank_transfer: '银行转账',
  gifted: '平台赠送',
}

const BILL_STATUS_LABELS: Record<string, string> = {
  paid: 'completed',
  pending: 'processing',
  processing: 'processing',
  failed: 'failed',
  expired: 'failed',
  cancelled: 'failed',
  refunded: 'failed',
}

export const rechargeOrdersRouter = createTRPCRouter({
  /** Preset top-up amounts, so the client never hardcodes the price list. */
  getConfig: protectedProcedure.query(() => ({
    amounts: ALLOWED_AMOUNTS,
    min: MIN_AMOUNT,
    max: MAX_AMOUNT,
    currency: 'CNY',
    simulation: isSimulationMode(),
    onlineChannel: resolveOnlineChannel(),
    bankTransfer: {
      accountName: process.env.BANK_TRANSFER_ACCOUNT_NAME ?? '',
      accountNumber: process.env.BANK_TRANSFER_ACCOUNT_NUMBER ?? '',
      bankName: process.env.BANK_TRANSFER_BANK_NAME ?? '',
      branchName: process.env.BANK_TRANSFER_BRANCH_NAME ?? '',
    },
  })),

  /**
   * Create a WeChat/Alipay top-up order.
   *
   * `userId` comes from the session and the amount is validated against the
   * server-side allowlist above, so a forged request cannot credit a wallet.
   */
  createPayment: protectedProcedure.input(onlineSchema).mutation(async ({ ctx, input }) => {
    const channel = resolveOnlineChannel()
    const gateway = getTopUpGateway(channel)

    const order = await createRechargeOrder({
      userId: ctx.user.id,
      amount: input.amount.toFixed(2),
      credits: (input.amount * CREDIT_RATE).toFixed(2),
      currency: 'CNY',
      paymentMethod: channel,
      orderType: channel,
    })

    const origin = websiteConfig.metadata.base_url
    try {
      const session = await gateway.createTopUp({
        orderId: order.orderId,
        amount: order.amount.toString(),
        currency: order.currency,
        subject: `OpenMCP 钱包充值 ¥${order.amount.toString()}`,
        origin,
      })

      const [updated] = await db
        .update(rechargeOrders)
        .set({ paymentUrl: session.redirectUrl ?? null, qrCode: session.qrPayload ?? null })
        .where(eq(rechargeOrders.orderId, order.orderId))
        .returning()

      return {
        success: true as const,
        data: {
          ...orderView(updated ?? order),
          qrCode: session.qrPayload,
          paymentUrl: session.redirectUrl,
          returnUrl: session.returnUrl,
          simulation: isSimulationMode(),
          /** Dev-only handle so the UI can trigger the fake gateway callback. */
          simulateUrl: isSimulationMode() ? `/api/pay/simulate/${order.orderId}` : null,
        },
      }
    } catch (error) {
      console.error('[recharge] createPayment failed', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '创建支付订单失败',
      })
    }
  }),

  /**
   * Create a bank-transfer order. Settlement is manual: an admin reconciles it
   * against the bank's statement, so this only reserves the order and the
   * remittance code the payer must put in the memo field.
   */
  createBankTransfer: protectedProcedure.input(bankSchema).mutation(async ({ ctx, input }) => {
    const order = await createRechargeOrder({
      userId: ctx.user.id,
      amount: input.amount.toFixed(2),
      credits: (input.amount * CREDIT_RATE).toFixed(2),
      currency: 'CNY',
      paymentMethod: 'bank_transfer',
      orderType: 'bank_transfer',
    })

    const voucher = await createBankTransferVoucher(order)

    return {
      success: true as const,
      data: {
        ...orderView(order),
        remittanceCode: voucher!.remittanceCode,
      },
    }
  }),

  /** Poll order status; used by the recharge page while a payment is pending. */
  checkStatus: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const order = await getRechargeOrderByOrderId(input.orderId)
      if (!order) return { success: false as const, error: '订单不存在' }
      // Never let one user read another user's order.
      if (order.userId !== ctx.user.id) {
        return { success: false as const, error: '订单不存在' }
      }

      // Lazily expire a stale online order so the UI stops showing it payable.
      if (
        order.status === 'pending' &&
        order.type !== 'bank_transfer' &&
        order.expiresAt.getTime() < Date.now()
      ) {
        await expireStaleOrders()
        return { success: true as const, data: { ...orderView(order), status: 'expired' as const } }
      }

      const voucher = order.type === 'bank_transfer' ? await getVoucherByOrderId(order.orderId) : null
      return {
        success: true as const,
        data: { ...orderView(order), remittanceCode: voucher?.remittanceCode ?? null },
      }
    }),

  /** Current user's top-up history. */
  history: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const orders = await listRechargeOrdersByUser(ctx.user.id, input?.limit ?? 20)
      return { success: true as const, data: orders.map(orderView) }
    }),

  /**
   * Paginated, filterable history for the console billing screens.
   *
   * Unlike `history`, which returns a flat list for compact widgets, this is
   * shaped for the bills table: total count, page slicing and an optional
   * created-at window.
   */
  getRechargeHistory: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, startDate, endDate } = input
      const offset = (page - 1) * pageSize

      const where = [eq(rechargeOrders.userId, ctx.user.id)]
      // An unparsable boundary is dropped rather than rejected: the date picker
      // can hand back a partial string, and that should widen the window, not
      // throw on every keystroke.
      if (startDate) {
        const from = new Date(startDate)
        if (!Number.isNaN(from.getTime())) where.push(gte(rechargeOrders.createdAt, from))
      }
      if (endDate) {
        const to = new Date(endDate)
        if (!Number.isNaN(to.getTime())) where.push(lte(rechargeOrders.createdAt, to))
      }

      const [row] = await db
        .select({ value: count() })
        .from(rechargeOrders)
        .where(and(...where))
      const total = row?.value ?? 0

      if (total === 0) {
        return {
          success: true as const,
          data: { records: [], total: 0, pageSize, currentPage: page, totalPages: 0 },
        }
      }

      const records = await db
        .select({
          id: rechargeOrders.id,
          orderId: rechargeOrders.orderId,
          amount: rechargeOrders.amount,
          credits: rechargeOrders.credits,
          status: rechargeOrders.status,
          type: rechargeOrders.type,
          paymentMethod: rechargeOrders.paymentMethod,
          remark: rechargeOrders.remark,
          createdAt: rechargeOrders.createdAt,
          paidAt: rechargeOrders.paidAt,
        })
        .from(rechargeOrders)
        .where(and(...where))
        .orderBy(desc(rechargeOrders.createdAt))
        .limit(pageSize)
        .offset(offset)

      return {
        success: true as const,
        data: {
          // Shaped for the bills table rather than the raw order row: the table
          // renders pre-localized channel/status labels, so those are resolved
          // here and the client only supplies the i18n copy for the type.
          records: records.map((record) => ({
            id: record.id,
            orderId: record.orderId,
            date: record.createdAt,
            amount: record.amount,
            credits: record.credits,
            type: record.type,
            channel: BILL_CHANNEL_LABELS[record.paymentMethod] ?? record.paymentMethod,
            status: BILL_STATUS_LABELS[record.status ?? ''] ?? 'failed',
            remark: record.remark ?? '',
          })),
          total,
          pageSize,
          currentPage: page,
          totalPages: Math.ceil(total / pageSize),
        },
      }
    }),

  /**
   * Wallet snapshot for the console balance widgets.
   *
   * The `balances` row is created on first read so a brand-new account has
   * somewhere to accumulate spend, and a missing row can never surface as a
   * thrown query error.
   */
  getUserBalance: protectedProcedure.input(z.object({})).query(async ({ ctx }) => {
    const userId = ctx.user.id

    const [profile] = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber,
        customerId: user.customerId,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!profile) {
      return { success: false as const, error: 'User not found' }
    }

    const balance = await getOrCreateBalance(userId)

    return {
      success: true as const,
      data: {
        accountBalance: balance.amountTotal,
        creditsBalance: balance.creditsTotal,
        amount: balance.amount,
        credits: balance.credits,
        amountGifted: balance.amountGifted,
        amountSpend: balance.amountSpend,
        creditsGifted: balance.creditsGifted,
        creditsSpend: balance.creditsSpend,
        user: profile,
      },
    }
  }),
})
