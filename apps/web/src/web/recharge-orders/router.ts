import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { rechargeOrders } from '@workspace/db'
import { db } from '@/lib/db'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'
import { isSimulationMode, getTopUpGateway, resolveOnlineChannel } from '@/server/payment/gateway'
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
})
