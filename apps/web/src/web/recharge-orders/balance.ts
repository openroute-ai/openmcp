import { eq } from 'drizzle-orm'
import { balances } from '@workspace/db'
import { db } from '@/lib/db'

/**
 * 钱包快照：数值统一 `Number()` 化，缺失行按 0 处理。
 *
 * The `balances` row is created on first read so a brand-new account has
 * somewhere to accumulate spend, and a missing row can never surface as a
 * thrown query error. The console balance widgets and the dashboard overview
 * both read through here so a brand-new account sees `0`, not an error.
 */
export interface BalanceSnapshot {
  /** 现金余额（CNY） */
  amount: number
  /** 赠金余额（CNY） */
  credits: number
  /** 累计充值（现金） */
  amountTotal: number
  /** 累计获赠（赠金） */
  creditsTotal: number
  /** 累计赠金收入（现金口径） */
  amountGifted: number
  /** 累计赠金收入（赠金口径） */
  creditsGifted: number
  /** 累计消费（现金） */
  amountSpend: number
  /** 累计消费（赠金） */
  creditsSpend: number
}

export async function getOrCreateBalance(userId: string): Promise<BalanceSnapshot> {
  const read = async () =>
    (
      await db
        .select({
          amount: balances.amount,
          credits: balances.credits,
          amountTotal: balances.amountTotal,
          creditsTotal: balances.creditsTotal,
          amountGifted: balances.amountGifted,
          amountSpend: balances.amountSpend,
          creditsGifted: balances.creditsGifted,
          creditsSpend: balances.creditsSpend,
        })
        .from(balances)
        .where(eq(balances.userId, userId))
        .limit(1)
    )[0]

  let row = await read()
  if (!row) {
    // `onConflictDoNothing` keeps this idempotent under concurrent first
    // reads; the unique index on balances.user_id is what makes it safe.
    await db
      .insert(balances)
      .values({ userId, currency: 'CNY' })
      .onConflictDoNothing({ target: balances.userId })
    row = await read()
  }

  return {
    amount: Number(row?.amount ?? 0),
    credits: Number(row?.credits ?? 0),
    amountTotal: Number(row?.amountTotal ?? 0),
    creditsTotal: Number(row?.creditsTotal ?? 0),
    amountGifted: Number(row?.amountGifted ?? 0),
    creditsGifted: Number(row?.creditsGifted ?? 0),
    amountSpend: Number(row?.amountSpend ?? 0),
    creditsSpend: Number(row?.creditsSpend ?? 0),
  }
}
