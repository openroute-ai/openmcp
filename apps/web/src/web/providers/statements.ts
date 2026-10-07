/**
 * 月度结算单：出账、确认、逾期自动确认、打款登记。
 *
 * 时间线（次月，对 `period` 为上一自然月的账单）：
 *
 *   5 日   generateStatements 为上月的收入行建账单，写 `pending`
 *   5–19 日 创作者本人 confirmStatement 确认
 *   19 日   autoConfirmOverdueStatements 把还没确认的账单自动确认
 *   20 日  财务线下转账后 markStatementPaid 回填凭证号，写 `paid`
 *
 * 三条不变量，缺一条就会变成"钱付了两次"或者"钱少付了"：
 *
 * 1. **一人一期一单。** `provider_statements(author_id, period, currency)`
 *    唯一约束，所以 cron 重跑只会跳过已存在的账单，不会把收入重复结算。
 * 2. **收入行只能属于一张账单。** 出账时把当月所有 `statement_id IS NULL`
 *    的行一次性挂上，跑第二遍时这些行已归属，聚合结果不变。
 * 3. **打款幂等。** `markStatementPaid` 用 `WHERE status = 'confirmed'`
 *    的条件更新 + 事务内 `returning()` 判定，只有真正完成流转的那一次
 *    才写 `paidAt` / 凭证号 / 把收入行置 `paid`。重复点击或重复 cron
 *    只会命中 0 行更新并返回"已打款"。
 *
 * 负账单（退款 clawback 撞上小规模收入）不允许确认也不打款：
 * `settlement < 0` 时账单落 `rolled`，缺口滚入下个月的 `carryover_amount`。
 * 滚入的方向是**下一期读上一期的负结算额**，所以连续三个月为负会一直累积。
 * 关键是只读"最近一期"而非"最近一张 `rolled`"：缺口一旦被某期抵扣完，
 * 那期就不再是 `rolled`，后面各期自然读到 0，同一笔欠款不会被扣两次。
 */

import { and, asc, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm"
import {
  a2aAgents,
  authors,
  createId,
  mcpServers,
  providerEarnings,
  providerProfiles,
  providerStatements,
  skills,
} from "@workspace/db"
import { db } from "@/lib/db"
import { PROVIDER_REVENUE_SHARE } from "./settlement"

export type StatementStatus = "pending" | "confirmed" | "paid" | "rolled"

/** 出账日：次月 5 日。 */
export const STATEMENT_GENERATE_DAY = 5
/** 确认截止日（含当日）：次月 19 日，逾期自动确认。 */
export const STATEMENT_CONFIRM_DEADLINE_DAY = 19
/** 打款日：次月 20 日。 */
export const STATEMENT_PAYOUT_DAY = 20

const MS_PER_DAY = 24 * 60 * 60 * 1000

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

type PayoutSnapshot = { channel: "wechat" | "alipay"; account: string }

/**
 * 读取创作者当前的收款通道，供出账时快照。
 *
 * 账号存在 `provider_profiles.metadata.payoutAccounts` 这个 JSON 里，与老的
 * `requestPayout` 读的是同一处 —— 这里刻意不抽公共函数，因为账单快照需要
 * 的是"出账那一刻的值"，而提现校验要的是"此刻的值"，两者语义不同。
 *
 * 返回 `null` 表示**没有可用的收款账号**。这不是错误：账单照常生成，
 * `payout_account` 留空，后台打款清单会把它显示成"待补账号"。拒绝对应的
 * 作者建不出账单会让他的钱卡在未归属状态，反而更难处理。
 */
async function snapshotPayoutAccount(
  authorId: string
): Promise<PayoutSnapshot | null> {
  const [profile] = await db
    .select({
      payChannelType: providerProfiles.payChannelType,
      metadata: providerProfiles.metadata,
    })
    .from(providerProfiles)
    .where(eq(providerProfiles.authorId, authorId))
    .limit(1)

  if (!profile) return null

  const channel =
    profile.payChannelType === "wechat" || profile.payChannelType === "alipay"
      ? profile.payChannelType
      : null

  const meta = (profile.metadata ?? {}) as {
    payoutAccounts?: Record<string, { account?: string }>
  }
  const account = channel
    ? meta.payoutAccounts?.[channel]?.account?.trim()
    : null

  if (!channel || !account) return null

  return { channel, account }
}

/** `YYYY-MM` for a date, in UTC — the settlement calendar is not local time. */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Splits `YYYY-MM` into its two numbers.
 *
 * Parsed once here rather than at each call site because a period reaches this
 * module from user input (an admin picking a month) as well as from `Date`:
 * `split('-').map(Number)` on `"2026-4"` yields a 1-digit month, and on garbage
 * yields `NaN`, which silently becomes an invalid `Date` instead of an error.
 */
function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  const year = Number(match?.[1])
  const month = Number(match?.[2])
  if (!month || month < 1 || month > 12)
    throw new Error(`invalid period: ${period}`)
  return { year, month }
}

/** The settlement month `period` bills: the calendar month before it. */
export function periodBefore(period: string): string {
  const { year, month } = parsePeriod(period)
  const shifted =
    month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return `${shifted.year}-${String(shifted.month).padStart(2, "0")}`
}

/** The statement due in `period` (paid on the 20th) covers `periodBefore(period)`. */
export function settlementPeriodFor(now: Date): string {
  return periodBefore(periodOf(now))
}

/**
 * UTC instant of `day` in the month **after** `period`.
 *
 * 次月是刻意的：账单结算的是 `period` 本身（`'2026-03'` 的收入在 4 月 5 日
 * 出账）。如果这里返回 `period` 当月的 5 日，3 月的账单会在 3 月 5 日就
 * 生成——而 3 月才刚过去两天，收入根本没发生完，账单会永远偏一个月，
 * 并且一生成就已经过了 19 日确认截止而被立刻自动确认。
 */
function dayAfter(period: string, day: number): Date {
  const { year, month } = parsePeriod(period)
  const shifted =
    month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return new Date(Date.UTC(shifted.year, shifted.month - 1, day))
}

/** 出账日：次月 5 日。 */
export function statementGenerateDate(period: string): Date {
  return dayAfter(period, STATEMENT_GENERATE_DAY)
}

/** 确认截止日：次月 19 日，过此日自动确认。 */
export function statementConfirmDeadline(period: string): Date {
  return dayAfter(period, STATEMENT_CONFIRM_DEADLINE_DAY)
}

/** 打款日：次月 20 日。 */
export function statementPayoutDate(period: string): Date {
  return dayAfter(period, STATEMENT_PAYOUT_DAY)
}

/** Half-open UTC bounds of a `YYYY-MM` period. */
function periodBounds(period: string): { start: Date; end: Date } {
  const { year, month } = parsePeriod(period)
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

function money(value: string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * 出账：为 `period` 的收入行建账单。
 *
 * 只处理「落在这个月、尚未归属任何账单」的收入行。`statement_id IS NOT NULL`
 * 是幂等的第一道闸：第二遍跑时这些行已经归属，`attached` 会是 0，于是跳过。
 * 第二道闸是唯一约束本身——即便两遍并发（每个副本都跑了 cron），
 * 第二遍也会在插入时撞上 `(author_id, period)` 唯一键。
 *
 * 只为**净收入非零**的创作者建账单。一笔全部退款导致的纯负月份不建单：
 * 没有可确认也没有可打款的金额，建一张空单只会在后台多出一行噪音，
 * 而 clawback 本身会在下个月和真实收入一起结算。
 */
export async function generateStatements(
  now = new Date(),
  options: { period?: string } = {}
): Promise<{
  period: string
  created: number
  rolled: number
  skipped: number
  errors: string[]
}> {
  const period = options.period ?? settlementPeriodFor(now)
  const { start, end } = periodBounds(period)
  const errors: string[] = []

  const rows = await db
    .select({
      authorId: providerEarnings.authorId,
      gross: sql<string>`coalesce(sum(${providerEarnings.grossAmount}), 0)`,
      fee: sql<string>`coalesce(sum(${providerEarnings.platformFee}), 0)`,
      net: sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`,
      currency: providerEarnings.currency,
      count: sql<number>`count(*)`,
    })
    .from(providerEarnings)
    .where(
      and(
        isNull(providerEarnings.statementId),
        // 候选集必须和 `createStatementForAuthor` 内部的口径一致。老
        // `payout_requests` 路径打款后会把收入行翻成 `paid` 而 `statement_id`
        // 仍为 NULL，只按 `statement_id IS NULL` 选候选的话，"这个月只剩已付过的
        // 历史收入"的作者仍会被选中，然后内部聚合成 net=0 并生成一张
        // payableAmount=0 的空账单。
        eq(providerEarnings.status, "payable"),
        gte(providerEarnings.createdAt, start),
        lt(providerEarnings.createdAt, end)
      )
    )
    .groupBy(providerEarnings.authorId, providerEarnings.currency)

  let created = 0
  let rolled = 0
  let skipped = 0

  for (const row of rows) {
    const net = money(row.net)
    if (net === 0 || row.count === 0) {
      skipped += 1
      continue
    }

    const payout = await snapshotPayoutAccount(row.authorId)

    const { inserted, statement } = await createStatementForAuthor({
      period,
      authorId: row.authorId,
      currency: row.currency,
      window: { start, end },
      errors,
      payout,
    })

    if (!inserted || !statement) {
      skipped += 1
      continue
    }
    if (statement.status === "rolled") rolled += 1
    else created += 1
  }

  return { period, created, rolled, skipped, errors }
}

/**
 * Creates and attaches one author's statement, returning `{ inserted: false }`
 * when it already exists.
 *
 * The attachment and the row insert share a transaction: an earnings row that
 * got attached but whose statement insert rolled back would be invisible to
 * the next run (it is no longer `IS NULL`) yet never billed.
 */
async function createStatementForAuthor(params: {
  period: string
  authorId: string
  currency: string
  window: { start: Date; end: Date }
  errors: string[]
  /** 出账时快照的收款通道/账号，见 `snapshotPayoutAccount`。 */
  payout: PayoutSnapshot | null
}): Promise<{
  inserted: boolean
  statement: typeof providerStatements.$inferSelect | null
}> {
  const { period, authorId, currency, window, errors, payout } = params

  try {
    return await db.transaction(async (tx) => {
      // `currency` 必须参与这个判重。唯一约束是
      // `(author_id, period, currency)`，若这里只按前两列查，一个同月已有
      // CNY 账单的 USD 作者会被判为"已存在"而跳过当月的美元账单——钱直接
      // 消失，且没有任何报错。
      const [existing] = await tx
        .select({ id: providerStatements.id })
        .from(providerStatements)
        .where(
          and(
            eq(providerStatements.authorId, authorId),
            eq(providerStatements.period, period),
            eq(providerStatements.currency, currency)
          )
        )
        .limit(1)
      if (existing) return { inserted: false, statement: null }

      // Only rows still unattached are aggregated, and they are aggregated
      // inside this transaction, so a concurrent run cannot fold the same row
      // into two statements.
      //
      // `status = 'payable'` 不是冗余条件，而是防重复付款的关键：老的
      // `payout_requests` 路径打款时会把收入行翻成 `paid`，但 `statement_id`
      // 仍然是 NULL。只按 `statement_id IS NULL` 过滤的话，这些**已经付过**
      // 的行会在下一次月度账单里被重新聚合，于是同一笔钱付两次。加了这个条件
      // 后，已走老路径付掉的收入只会显示在老的提现记录里，不会进账单。
      const [totals] = await tx
        .select({
          gross: sql<string>`coalesce(sum(${providerEarnings.grossAmount}), 0)`,
          fee: sql<string>`coalesce(sum(${providerEarnings.platformFee}), 0)`,
          net: sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`,
        })
        .from(providerEarnings)
        .where(
          and(
            isNull(providerEarnings.statementId),
            eq(providerEarnings.status, "payable"),
            eq(providerEarnings.authorId, authorId),
            eq(providerEarnings.currency, currency),
            gte(providerEarnings.createdAt, window.start),
            lt(providerEarnings.createdAt, window.end)
          )
        )

      const net = money(totals?.net)
      const carryover = await pendingCarryover(tx, authorId, period)
      const settlementValue = round2(net + carryover)
      const settlementNumber = Number(settlementValue)
      const payable = settlementNumber < 0 ? 0 : settlementNumber

      const inserted = await tx
        .insert(providerStatements)
        .values({
          id: createId(),
          authorId,
          period,
          currency,
          grossAmount: round2(money(totals?.gross)),
          platformFee: round2(money(totals?.fee)),
          netAmount: round2(net),
          carryoverAmount: round2(carryover),
          settlement: settlementValue,
          payableAmount: round2(payable),
          status: settlementNumber < 0 ? "rolled" : "pending",
          // 收款信息在**出账时**快照，而不是打款时再读 profile：创作者可能
          // 在 5 日到 20 日之间换绑账号，那样钱会打到新账号，而账单和银行
          // 流水都对不上。快照让"这张账单该付给谁"在出账那一刻就固定。
          payoutChannel: payout?.channel ?? null,
          payoutAccount: payout?.account ?? null,
          generatedAt: new Date(),
        })
        .returning()
      const statement = inserted[0]
      if (!statement) {
        // `returning()` on an insert that matched a row is always length 1, so
        // an empty result means the driver lost the row rather than that
        // nothing was written. Failing here leaves the earnings unattached and
        // the next run can retry, which is the recoverable outcome.
        throw new Error("statement insert returned no row")
      }

      await tx
        .update(providerEarnings)
        .set({ statementId: statement.id })
        .where(
          and(
            isNull(providerEarnings.statementId),
            // 必须和上面聚合用同一个 `payable` 口径。少了它，已经通过老
            // `payout_requests` 付掉的 `paid` 行会在同一期被这次 UPDATE 顺手
            // 认领：金额虽然没被重复计入（聚合已经过滤了），但账单明细里会出现
            // 一笔从未参与本次结算的收入，对账时会误以为平台又欠了这笔钱。
            eq(providerEarnings.status, "payable"),
            eq(providerEarnings.authorId, authorId),
            eq(providerEarnings.currency, currency),
            gte(providerEarnings.createdAt, window.start),
            lt(providerEarnings.createdAt, window.end)
          )
        )

      return { inserted: true, statement }
    })
  } catch (error) {
    // One author's failure must not abort the whole run: the others' money is
    // just as real, and the next cron picks this one up because nothing was
    // attached.
    errors.push(
      `${authorId}: ${error instanceof Error ? error.message : "unknown error"}`
    )
    return { inserted: false, statement: null }
  }
}

/**
 * 上一期滚入的负数缺口。
 *
 * 找的是最近一张 `rolled` 的更早账单，取它的 `settlement`（已经是负数，
 * 且已经含它自己那期的 carryover），所以「三月 -30、四月 -10」在五月会
 * 一次性看到 -40，而不是只看到上一期的 -10。
 */
async function pendingCarryover(
  tx: Pick<typeof db, "select">,
  authorId: string,
  period: string
): Promise<number> {
  // 只看**最近一期**账单，而不是"最近一张 `rolled`"账单。
  //
  // 区别在于缺口是否已被消费：三月 -30、四月 +40 抵扣后结算 +10（已吸收
  // 那笔缺口），若按"最近一张 rolled"查，五月又会看到三月的 -30 并再扣
  // 一次——等于同一笔欠款被抵扣两遍。按最近一期查则四月不是 `rolled`，
  // 五月拿到 0，恰好正确。
  //
  // 中间月份完全没有账单（当月净额为 0 被跳过）时，最近一期仍是三月，
  // 缺口继续滚——这也正是期望行为，欠款不因为某月没生意就消失。
  const [prev] = await tx
    .select({
      status: providerStatements.status,
      settlement: providerStatements.settlement,
    })
    .from(providerStatements)
    .where(
      and(
        eq(providerStatements.authorId, authorId),
        lt(providerStatements.period, period)
      )
    )
    .orderBy(desc(providerStatements.period))
    .limit(1)

  if (prev?.status !== "rolled") return 0
  const value = money(prev.settlement)
  return value < 0 ? value : 0
}

/**
 * 创作者确认账单。
 *
 * `rolled` 账单（结算额为负）不可确认——确认它等于确认一笔要倒扣的钱，
 * 而扣款是下期自动抵扣的事，不需要创作者同意。这也是唯一需要拒绝的分支：
 * `paid` 已经打款，再确认会覆盖时间线；`confirmed` 幂等返回。
 */
export async function confirmStatement(params: {
  authorId: string
  statementId: string
  userId: string
  /** 财务代确认：财务为真值时记 `confirmedBy`，让审计能区分。 */
  onBehalf?: boolean
}): Promise<
  { ok: true; statement: StatementView } | { ok: false; error: string }
> {
  const [row] = await db
    .select()
    .from(providerStatements)
    .where(
      and(
        eq(providerStatements.id, params.statementId),
        eq(providerStatements.authorId, params.authorId)
      )
    )
    .limit(1)
  if (!row) return { ok: false, error: "账单不存在" }

  if (row.status === "rolled") {
    return { ok: false, error: "账单为负数，将在下月抵扣，无法确认" }
  }
  if (row.status === "paid") {
    return { ok: false, error: "账单已打款" }
  }
  if (row.status === "confirmed") {
    return { ok: true, statement: toView(row) }
  }

  const [updated] = await db
    .update(providerStatements)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedBy: params.onBehalf ? params.userId : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(providerStatements.id, params.statementId),
        eq(providerStatements.status, "pending")
      )
    )
    .returning()

  if (!updated) {
    const [current] = await db
      .select()
      .from(providerStatements)
      .where(eq(providerStatements.id, params.statementId))
      .limit(1)
    if (!current) return { ok: false, error: "账单不存在" }
    return { ok: true, statement: toView(current) }
  }

  return { ok: true, statement: toView(updated) }
}

/**
 * 逾期自动确认：确认截止日已过仍是 `pending` 的账单视为已确认。
 *
 * 跑两遍是安全的：条件更新只命中仍为 `pending` 的行，第二遍命中 0 行。
 * `rolled` 不参与——负账单没有可确认的金额。
 */
export async function autoConfirmOverdueStatements(
  now = new Date()
): Promise<{ autoConfirmed: number; checked: number; errors: string[] }> {
  const overdue = await db
    .select({ id: providerStatements.id, period: providerStatements.period })
    .from(providerStatements)
    .where(eq(providerStatements.status, "pending"))

  const errors: string[] = []
  let autoConfirmed = 0

  for (const row of overdue) {
    const deadline = statementConfirmDeadline(row.period)
    if (now < deadline) continue

    try {
      const result = await db
        .update(providerStatements)
        .set({
          status: "confirmed",
          confirmedAt: now,
          // 自动确认不是任何人点的，记system 以免 `confirmedBy` 冒充用户。
          confirmedBy: "system",
          updatedAt: now,
        })
        .where(
          and(
            eq(providerStatements.id, row.id),
            eq(providerStatements.status, "pending")
          )
        )
      if (result.rowCount && result.rowCount > 0) autoConfirmed += 1
    } catch (error) {
      // 一张账单失败不该挡住其余账单：条件更新已经保证不会重复确认，
      // 这张下次 cron 会再来一次。
      errors.push(
        `${row.id}: ${error instanceof Error ? error.message : "unknown error"}`
      )
    }
  }

  return { autoConfirmed, checked: overdue.length, errors }
}

/**
 * 财务线下转账后登记打款。
 *
 * 幂等由条件更新承担：只有 `status = 'confirmed'` 的行能被更新成 `paid`，
 * 所以重复提交（含 cron 与后台双触发）第二次必然命中 0 行，返回
 * `{ ok: true, alreadyPaid: true }` 而不是把 `paidAt` 刷新一次。
 *
 * 收入行在同一事务里一起置 `paid`，否则账单显示已付而明细仍是可提现，
 * 创作者会看到同一笔钱可提现两次。
 */
export async function markStatementPaid(params: {
  statementId: string
  adminUserId: string
  payoutReference: string
  adminNote?: string
}): Promise<
  | { ok: true; alreadyPaid: boolean; statement: StatementView }
  | { ok: false; error: string }
> {
  const reference = params.payoutReference.trim()
  if (!reference) return { ok: false, error: "请填写打款凭证号" }

  const [row] = await db
    .select()
    .from(providerStatements)
    .where(eq(providerStatements.id, params.statementId))
    .limit(1)
  if (!row) return { ok: false, error: "账单不存在" }

  if (row.status === "paid") {
    return { ok: true, alreadyPaid: true, statement: toView(row) }
  }
  if (row.status === "rolled") {
    return { ok: false, error: "负数账单不打款，缺口已滚入下月抵扣" }
  }
  if (row.status === "pending") {
    return { ok: false, error: "账单尚未确认，请等待创作者确认或逾期自动确认" }
  }

  const now = new Date()
  const paid = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(providerStatements)
      .set({
        status: "paid",
        paidAt: now,
        paidBy: params.adminUserId,
        payoutReference: reference,
        adminNote: params.adminNote ?? row.adminNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(providerStatements.id, params.statementId),
          eq(providerStatements.status, "confirmed")
        )
      )
      .returning()

    if (!updated) return null

    await tx
      .update(providerEarnings)
      .set({ status: "paid" })
      .where(
        and(
          eq(providerEarnings.statementId, params.statementId),
          eq(providerEarnings.status, "payable")
        )
      )

    return updated
  })

  if (!paid) {
    const [current] = await db
      .select()
      .from(providerStatements)
      .where(eq(providerStatements.id, params.statementId))
      .limit(1)
    if (current?.status === "paid") {
      return { ok: true, alreadyPaid: true, statement: toView(current) }
    }
    return {
      ok: false,
      error: current ? `账单状态为 ${current.status}，未打款` : "账单不存在",
    }
  }

  return { ok: true, alreadyPaid: false, statement: toView(paid) }
}

export type StatementView = ReturnType<typeof toView>

function toView(row: typeof providerStatements.$inferSelect) {
  return {
    id: row.id,
    authorId: row.authorId,
    period: row.period,
    currency: row.currency,
    grossAmount: money(row.grossAmount),
    platformFee: money(row.platformFee),
    netAmount: money(row.netAmount),
    carryoverAmount: money(row.carryoverAmount),
    settlement: money(row.settlement),
    payableAmount: money(row.payableAmount),
    status: row.status,
    generatedAt: row.generatedAt,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    paidAt: row.paidAt,
    paidBy: row.paidBy,
    payoutReference: row.payoutReference,
    payoutChannel: row.payoutChannel,
    payoutAccount: row.payoutAccount,
    adminNote: row.adminNote,
    revenueShare: PROVIDER_REVENUE_SHARE,
  }
}

/** 创作者视角：自己的账单 + 每期应付合计，用于 earnings 页。 */
export async function listMyStatements(
  authorId: string,
  options: { page?: number; pageSize?: number } = {}
) {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 24
  const rows = await db
    .select()
    .from(providerStatements)
    .where(eq(providerStatements.authorId, authorId))
    .orderBy(desc(providerStatements.period))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  // summary 必须覆盖全部账单而不是当前页：只统计当前页会让"累计已付"随翻页变化。
  const [[sums], [totalRow]] = await Promise.all([
    db
      .select({
        pending: sql<string>`coalesce(sum(case when ${providerStatements.status} = 'pending' then ${providerStatements.payableAmount} else 0 end), 0)`,
        confirmed: sql<string>`coalesce(sum(case when ${providerStatements.status} = 'confirmed' then ${providerStatements.payableAmount} else 0 end), 0)`,
        paid: sql<string>`coalesce(sum(case when ${providerStatements.status} = 'paid' then ${providerStatements.payableAmount} else 0 end), 0)`,
        rolled: sql<string>`coalesce(sum(case when ${providerStatements.status} = 'rolled' then -${providerStatements.settlement} else 0 end), 0)`,
        // 累计净收入：所有账单的本期结算合计（含负账单、含已抵扣完的），是
        // "这个创作者一共赚到多少"的口径，与"打出去多少钱"（paid）不同。
        netTotal: sql<string>`coalesce(sum(${providerStatements.settlement}), 0)`,
      })
      .from(providerStatements)
      .where(eq(providerStatements.authorId, authorId)),
    db
      .select({ n: count() })
      .from(providerStatements)
      .where(eq(providerStatements.authorId, authorId)),
  ])

  return {
    rows: rows.map(toView),
    total: totalRow?.n ?? 0,
    page,
    pageSize,
    summary: {
      pending: money(sums?.pending),
      confirmed: money(sums?.confirmed),
      paid: money(sums?.paid),
      // 展示为正数的"待抵扣"，因为它是一个将要扣掉的钱。
      rolled: money(sums?.rolled),
      netTotal: money(sums?.netTotal),
    },
  }
}

/** 某张账单下被结算的收入行，用于账单详情核对。 */
export async function listStatementEarnings(statementId: string) {
  const rows = await db
    .select({
      id: providerEarnings.id,
      skillId: providerEarnings.skillId,
      // MCP / A2A 归属。账单详情要能对上「这笔收入来自哪个资产」，否则一列
      // 只有金额和 entitlementId 的行没法解释。
      assetType: providerEarnings.assetType,
      assetId: providerEarnings.assetId,
      kind: providerEarnings.kind,
      grossAmount: providerEarnings.grossAmount,
      platformFee: providerEarnings.platformFee,
      netAmount: providerEarnings.netAmount,
      currency: providerEarnings.currency,
      status: providerEarnings.status,
      entitlementId: providerEarnings.entitlementId,
      gatewayRecordId: providerEarnings.gatewayRecordId,
      createdAt: providerEarnings.createdAt,
    })
    .from(providerEarnings)
    .where(eq(providerEarnings.statementId, statementId))
    .orderBy(asc(providerEarnings.createdAt))

  return rows.map((row) => ({
    ...row,
    grossAmount: money(row.grossAmount),
    platformFee: money(row.platformFee),
    netAmount: money(row.netAmount),
  }))
}

/**
 * 展示用的收入来源名：Skill 标题 → MCP/A2A 名称 → null。
 *
 * 三种来源互斥（`skill_id` 与 `asset_type` 不会同时有值），都没有时是解析不出
 * 资产名的网关调用，由 UI 显示"网关调用"而不是一个空单元格。
 */
function sourceNameOf(row: {
  skillTitle: string | null
  assetType: string | null
  mcpServerName: string | null
  a2aAgentName: string | null
}): string | null {
  return (
    row.skillTitle ??
    (row.assetType === 'mcp'
      ? row.mcpServerName
      : row.assetType === 'a2a'
        ? row.a2aAgentName
        : null)
  )
}

/**
 * 创作者视角的逐笔明细：解析出来源名、按时间倒序、分页。
 *
 * 与 `listStatementEarnings`（后台核对用的全量升序版）分开，是因为创作者页
 * 面要回答"最近发生了什么"，且收益行可能上千条，不封顶的全量返回会拖垮详情页。
 */
export async function listMyStatementEarnings(
  statementId: string,
  options: { page?: number; pageSize?: number } = {}
) {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 20
  const rows = await db
    .select({
      id: providerEarnings.id,
      kind: providerEarnings.kind,
      skillId: providerEarnings.skillId,
      skillTitle: skills.title,
      assetType: providerEarnings.assetType,
      assetId: providerEarnings.assetId,
      mcpServerName: mcpServers.serverName,
      a2aAgentName: a2aAgents.agentName,
      grossAmount: providerEarnings.grossAmount,
      platformFee: providerEarnings.platformFee,
      netAmount: providerEarnings.netAmount,
      currency: providerEarnings.currency,
      status: providerEarnings.status,
      createdAt: providerEarnings.createdAt,
    })
    .from(providerEarnings)
    // `asset_id` 不带跨表 FK，归属由应用层按 `asset_type` 选表连接（与
    // `listMyEarnings` 同一套 join），所以两个都是 left join。
    .leftJoin(skills, eq(providerEarnings.skillId, skills.id))
    .leftJoin(mcpServers, eq(providerEarnings.assetId, mcpServers.id))
    .leftJoin(a2aAgents, eq(providerEarnings.assetId, a2aAgents.id))
    .where(eq(providerEarnings.statementId, statementId))
    .orderBy(desc(providerEarnings.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [totalRow] = await db
    .select({ n: count() })
    .from(providerEarnings)
    .where(eq(providerEarnings.statementId, statementId))

  return {
    rows: rows.map((row) => ({
      ...row,
      grossAmount: money(row.grossAmount),
      platformFee: money(row.platformFee),
      netAmount: money(row.netAmount),
      sourceName: sourceNameOf(row),
    })),
    total: totalRow?.n ?? 0,
    page,
    pageSize,
  }
}

/**
 * 一张账单的收益构成：按「来源 + 类型」聚合，用于详情页的汇总表。
 *
 * `kind` 参与分组而不是只按来源聚合：退款冲回是负数行，混进销售里会让这一行
 * 看起来像"卖了一笔负数"，创作者无从解释当月净收入为什么少了。
 */
export async function statementBreakdown(statementId: string) {
  const rows = await db
    .select({
      kind: providerEarnings.kind,
      skillId: providerEarnings.skillId,
      skillTitle: skills.title,
      assetType: providerEarnings.assetType,
      assetId: providerEarnings.assetId,
      mcpServerName: mcpServers.serverName,
      a2aAgentName: a2aAgents.agentName,
      currency: providerEarnings.currency,
      count: count(),
      grossAmount: sql<string>`coalesce(sum(${providerEarnings.grossAmount}), 0)`,
      platformFee: sql<string>`coalesce(sum(${providerEarnings.platformFee}), 0)`,
      netAmount: sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`,
    })
    .from(providerEarnings)
    .leftJoin(skills, eq(providerEarnings.skillId, skills.id))
    .leftJoin(mcpServers, eq(providerEarnings.assetId, mcpServers.id))
    .leftJoin(a2aAgents, eq(providerEarnings.assetId, a2aAgents.id))
    .where(eq(providerEarnings.statementId, statementId))
    .groupBy(
      providerEarnings.kind,
      providerEarnings.skillId,
      providerEarnings.assetType,
      providerEarnings.assetId,
      providerEarnings.currency,
      skills.title,
      mcpServers.serverName,
      a2aAgents.agentName
    )
    // 按净收入从大到小：创作者最先想看的是"哪块最赚钱"，冲回自然沉底。
    .orderBy(desc(sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`))

  return rows.map((row) => ({
    kind: row.kind,
    currency: row.currency,
    count: Number(row.count ?? 0),
    grossAmount: money(row.grossAmount),
    platformFee: money(row.platformFee),
    netAmount: money(row.netAmount),
    sourceName: sourceNameOf(row),
  }))
}

/**
 * 创作者视角的单张账单详情：账单本体 + 时间线 + 收益构成 + 分页逐笔明细。
 *
 * 归属校验写在 SQL 的 WHERE 里而不是查出来再比 `authorId`：越权请求要返回
 * 「不存在」而不是「无权访问」，否则会把"这个 id 是否属于别人"泄露出去。
 */
export async function getMyStatement(
  authorId: string,
  statementId: string,
  options: { page?: number; pageSize?: number } = {}
) {
  const [row] = await db
    .select()
    .from(providerStatements)
    .where(
      and(
        eq(providerStatements.id, statementId),
        eq(providerStatements.authorId, authorId)
      )
    )
    .limit(1)

  if (!row) return null

  const [earnings, breakdown] = await Promise.all([
    listMyStatementEarnings(statementId, options),
    statementBreakdown(statementId),
  ])

  return {
    statement: toView(row),
    timeline: statementTimeline(row.period),
    breakdown,
    earnings,
  }
}

export type AdminStatementRow = {
  id: string
  authorId: string
  authorName: string | null
  authorUsername: string | null
} & StatementView

/** 后台列表：按状态 / 月份筛选，带作者信息。 */
export async function adminListStatements(
  options: { status?: StatementStatus; period?: string; limit?: number } = {}
) {
  const conditions = []
  if (options.status)
    conditions.push(eq(providerStatements.status, options.status))
  if (options.period)
    conditions.push(eq(providerStatements.period, options.period))

  const rows = await db
    .select({
      statement: providerStatements,
      authorName: authors.name,
      authorUsername: authors.username,
    })
    .from(providerStatements)
    .leftJoin(authors, eq(providerStatements.authorId, authors.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(providerStatements.period),
      desc(providerStatements.createdAt)
    )
    .limit(options.limit ?? 100)

  return rows.map((row) => ({
    ...toView(row.statement),
    authorName: row.authorName,
    authorUsername: row.authorUsername,
  }))
}

/** 打款日已到、且处于 `confirmed` 的账单：财务当天的待办清单。 */
export async function adminListPayableStatements(
  now = new Date(),
  limit = 100
) {
  const rows = await db
    .select({
      statement: providerStatements,
      authorName: authors.name,
      authorUsername: authors.username,
    })
    .from(providerStatements)
    .leftJoin(authors, eq(providerStatements.authorId, authors.id))
    .where(eq(providerStatements.status, "confirmed"))
    .orderBy(asc(providerStatements.period))
    .limit(limit)

  return rows.map((row) => ({
    ...toView(row.statement),
    authorName: row.authorName,
    authorUsername: row.authorUsername,
    payoutDate: statementPayoutDate(row.statement.period),
    due: now >= statementPayoutDate(row.statement.period),
  }))
}

/** 单张账单 + 明细收入行，供财务核对。 */
export async function adminGetStatement(id: string): Promise<{
  statement: ReturnType<typeof toView>
  authorName: string | null
  authorUsername: string | null
  earnings: Awaited<ReturnType<typeof listStatementEarnings>>
} | null> {
  const [row] = await db
    .select({
      statement: providerStatements,
      authorName: authors.name,
      authorUsername: authors.username,
    })
    .from(providerStatements)
    .leftJoin(authors, eq(providerStatements.authorId, authors.id))
    .where(eq(providerStatements.id, id))
    .limit(1)

  if (!row) return null

  return {
    statement: toView(row.statement),
    authorName: row.authorName,
    authorUsername: row.authorUsername,
    earnings: await listStatementEarnings(id),
  }
}

/**
 * 未归属任何账单的收入总额，用于后台"待出账"提示。
 *
 * 截止线是**上一期的出账日**（本月 5 日），而不是"所有未归属的行"：
 * 出账只处理整月，本月 5 日之后产生的收入本来就不该已出账，把它们算进来
 * 会让这个数字永远不为零、看不出真正漏跑的那部分。
 *
 * 同样只看 `payable`：`paid` 的行是已经通过老的 `payout_requests` 打出去的钱，
 * 它们永远不会进账单，所以不该被算成"漏出账了"。把它们计入会让后台一直提示
 * 有未出账收入，而实际上那些钱早已付清——一个会让人去查错方向的假警报。
 */
export async function unbilledEarningsTotal(
  now = new Date()
): Promise<{ count: number; net: number }> {
  const cutoff = statementGenerateDate(settlementPeriodFor(now))
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      net: sql<string>`coalesce(sum(${providerEarnings.netAmount}), 0)`,
    })
    .from(providerEarnings)
    .where(
      and(
        isNull(providerEarnings.statementId),
        eq(providerEarnings.status, "payable"),
        lt(providerEarnings.createdAt, cutoff)
      )
    )

  return { count: row?.count ?? 0, net: money(row?.net) }
}

export { money as toMoney, round2 as toRoundedMoney }

/**
 * 一个周期的时间线，用于创作者页与后台共用同一套日期。
 *
 * 三个日期都落在 `period` 的**次月**：`2026-03` 的账单 4 月 5 日出账、
 * 4 月 19 日确认截止、4 月 20 日打款。页面因此不需要自己加月份。
 */
export function statementTimeline(period: string, now = new Date()) {
  const generateDate = statementGenerateDate(period)
  const confirmDeadline = statementConfirmDeadline(period)
  const payoutDate = statementPayoutDate(period)

  return {
    period,
    generateDate,
    confirmDeadline,
    payoutDate,
    /** 负数表示已过期，用于页面提示"逾期未确认将于X 日自动确认"。 */
    daysUntilPayout: Math.ceil(
      (payoutDate.getTime() - now.getTime()) / MS_PER_DAY
    ),
    daysUntilConfirmDeadline: Math.ceil(
      (confirmDeadline.getTime() - now.getTime()) / MS_PER_DAY
    ),
    /** 现在是否还能由创作者本人确认。 */
    canConfirm: now < confirmDeadline,
  }
}
