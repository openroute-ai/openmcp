import { createId } from '@workspace/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { bankTransferVouchers, rechargeOrders } from '@workspace/db'
import type { RechargeOrderStatus, RechargeOrderType } from '@workspace/db'
import { ensureWallet } from './settle'

export type RechargeOrderRow = typeof rechargeOrders.$inferSelect

/** How long an online payment order stays payable. */
const ORDER_TTL_MS = 30 * 60 * 1000

/**
 * Remittance code shown to the user on a bank transfer.
 *
 * Not a primary key and not an id, so it is prefixed to keep it recognisable in
 * a bank's memo field and to make an accidental collision with a real id
 * impossible. The suffix is cuid2 rather than a counter or timestamp, because
 * the code is a bearer token for crediting a wallet and must not be guessable.
 */
export const generateRemittanceCode = (): string =>
  `RC${createId().replace(/[^a-z0-9]/gi, '').slice(0, 16).toUpperCase()}`

/**
 * `orderId` is what the gateway and the admin console both key on. The prefix
 * records the channel so a callback can be routed without a lookup, matching
 * the convention the webhook routes expect.
 */
export const buildOrderId = (method: RechargeOrderType): string => {
  const prefix = method === 'bank_transfer' ? 'bank' : method === 'alipay' ? 'alipay' : 'wechat'
  return `${prefix}_${createId()}`
}

export type CreateRechargeOrderInput = {
  userId: string
  amount: string
  credits: string
  currency: string
  paymentMethod: string
  orderType: RechargeOrderType
  ip?: string
  userAgent?: string
}

export async function createRechargeOrder(
  input: CreateRechargeOrderInput
): Promise<RechargeOrderRow> {
  await ensureWallet(input.userId)

  const orderId = buildOrderId(input.orderType)
  const [row] = await db
    .insert(rechargeOrders)
    .values({
      id: createId(),
      orderId,
      userId: input.userId,
      amount: input.amount,
      credits: input.credits,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      type: input.orderType,
      // A bank transfer has no gateway to expire it, so it parks indefinitely
      // in `pending_transfer` until an admin reviews it.
      status: input.orderType === 'bank_transfer' ? 'pending_transfer' : 'pending',
      expiresAt: new Date(Date.now() + ORDER_TTL_MS),
      ip: input.ip,
      userAgent: input.userAgent,
    })
    .returning()

  return row!
}

/** Bank transfer companion row carrying the memo code the user must supply. */
export async function createBankTransferVoucher(order: RechargeOrderRow) {
  const [row] = await db
    .insert(bankTransferVouchers)
    .values({
      id: createId(),
      orderId: order.orderId,
      remittanceCode: generateRemittanceCode(),
      userId: order.userId,
      amount: order.amount,
    })
    .returning()
  return row!
}

export async function getRechargeOrderByOrderId(
  orderId: string
): Promise<RechargeOrderRow | null> {
  const [row] = await db
    .select()
    .from(rechargeOrders)
    .where(eq(rechargeOrders.orderId, orderId))
    .limit(1)
  return row ?? null
}

export async function getVoucherByOrderId(orderId: string) {
  const [row] = await db
    .select()
    .from(bankTransferVouchers)
    .where(eq(bankTransferVouchers.orderId, orderId))
    .limit(1)
  return row ?? null
}

export async function getVoucherByRemittanceCode(remittanceCode: string) {
  const [row] = await db
    .select()
    .from(bankTransferVouchers)
    .where(eq(bankTransferVouchers.remittanceCode, remittanceCode))
    .limit(1)
  return row ?? null
}

export async function listRechargeOrdersByUser(
  userId: string,
  limit = 20
): Promise<RechargeOrderRow[]> {
  return db
    .select()
    .from(rechargeOrders)
    .where(eq(rechargeOrders.userId, userId))
    .orderBy(desc(rechargeOrders.createdAt))
    .limit(limit)
}

export type ListVouchersFilter = {
  status?: string
  search?: string
  limit: number
  offset: number
}

/** Admin console listing for bank-transfer reconciliation. */
export async function listVouchersForAdmin(
  filter: ListVouchersFilter
): Promise<{ items: (typeof bankTransferVouchers.$inferSelect)[]; total: number }> {
  const conditions = []
  if (filter.status && filter.status !== 'all') {
    conditions.push(eq(bankTransferVouchers.status, filter.status))
  }
  if (filter.search) {
    const term = `%${filter.search}%`
    conditions.push(sql`(${bankTransferVouchers.remittanceCode} ILIKE ${term} OR ${bankTransferVouchers.payerName} ILIKE ${term} OR ${bankTransferVouchers.orderId} ILIKE ${term})`)
  }
  const where = conditions.length ? and(...conditions) : undefined

  const items = await db
    .select()
    .from(bankTransferVouchers)
    .where(where)
    .orderBy(desc(bankTransferVouchers.createdAt))
    .limit(filter.limit)
    .offset(filter.offset)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bankTransferVouchers)
    .where(where)

  return { items, total: countRow?.count ?? 0 }
}

export async function markVoucherReviewed(params: {
  orderId: string
  status: 'confirmed' | 'rejected'
  reviewedBy: string
  rejectReason?: string
}) {
  const [row] = await db
    .update(bankTransferVouchers)
    .set({
      status: params.status,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      rejectReason: params.rejectReason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bankTransferVouchers.orderId, params.orderId),
        // Only a still-pending voucher can be reviewed, so a double click or a
        // second admin cannot confirm the same transfer twice.
        sql`${bankTransferVouchers.status} = 'pending'`
      )
    )
    .returning()

  return row ?? null
}

/** Best-effort sweep so abandoned online orders stop showing as payable. */
export async function expireStaleOrders(): Promise<number> {
  const rows = await db
    .update(rechargeOrders)
    .set({ status: 'expired' satisfies RechargeOrderStatus, updatedAt: new Date() })
    .where(
      and(
        sql`${rechargeOrders.status} = 'pending'`,
        sql`${rechargeOrders.expiresAt} < now()`
      )
    )
    .returning({ orderId: rechargeOrders.orderId })
  return rows.length
}
