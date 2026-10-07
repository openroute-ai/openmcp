/**
 * 唯一有权开通权益的地方。
 *
 * 微信回调、开发期的模拟回调都只做三件事：验签（网关做的）、核金额（这里做的）、
 * 落单开通（这里做的）。任何别的路径——管理后台、脚本、未来的支付宝——要开通
 * 订阅都必须经过这一个函数，否则"这笔钱到底开没开通"就要问两个地方。
 *
 * 三条不变量：
 *
 * 1. **金额必须对得上。** 签名合法但金额不符是篡改信号，不是四舍五入问题，拒绝。
 * 2. **过期订单不认领。** `expires_at` 之后回调才到，说明用户扫的是上一张码。
 *    钱可能真扣了，所以这返回一个可区分的 code 供人工处理，而不是当没看见。
 * 3. **开通是幂等的。** 认领靠 `status = 'pending'` 的条件更新，重复回调更新 0 行，
 *    于是不会把一个月的订阅开通两次。
 *
 * 权益从 `max(now, 现有到期日)` 往后接：提前续费不该把已经付过的那段时间丢掉。
 */
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { addCycle } from "@/lib/billing/plans"
import {
  subscriptionOrders,
  userSubscriptions,
  type SubscriptionPlan,
} from "@/db/schema/billing"

/** 谁触发的结算。只进日志与 `webhook_data`，不参与任何判断。 */
export type SettleReason = "wechat_webhook" | "dev_simulated"

export type SettleResult =
  | { ok: true; alreadySettled: boolean; orderId: string; activeUntil: Date }
  | { ok: false; code: "NOT_FOUND" | "AMOUNT_MISMATCH" | "EXPIRED"; error: string }

/**
 * 网关报的金额（元）→ 分。
 *
 * 与订单里存的整数分比较，所以这里必须是整数：`99.00 * 100` 在浮点里是
 * `9899.999999999998`，`Math.round` 是必须的，不是防御性的。
 */
function toFen(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

async function readSubscription(userId: string, plan: SubscriptionPlan) {
  const rows = await db
    .select({ activeUntil: userSubscriptions.activeUntil })
    .from(userSubscriptions)
    .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.plan, plan)))
    .limit(1)
  return rows[0] ?? null
}

export async function settleSubscriptionOrder(params: {
  orderId: string
  reason: SettleReason
  /** 网关报的金额（元）。真实回调是验签并解密后的 `amount.total` 换算值。 */
  reportedAmount?: string | number
  transactionId?: string
  webhookData?: Record<string, unknown>
}): Promise<SettleResult> {
  const [order] = await db
    .select()
    .from(subscriptionOrders)
    .where(eq(subscriptionOrders.id, params.orderId))
    .limit(1)

  if (!order) {
    return { ok: false, code: "NOT_FOUND", error: "订单不存在" }
  }

  if (order.status === "paid") {
    const existing = await readSubscription(order.userId, order.plan)
    return {
      ok: true,
      alreadySettled: true,
      orderId: order.id,
      activeUntil: existing?.activeUntil ?? order.paidAt ?? new Date(),
    }
  }

  // 非 `pending` 也不 `paid` 的单只有两个去向：`expired`（没人扫）或 `closed`
  // （网关下单失败，用户从来没见过码）。回调命中这两者都不该被"认领"成
  // `alreadySettled`——那会拿一张没付成钱的单当成已开通。钱真扣了要去人工核对，
  // 所以是可区分的拒绝，不是无声放行。
  if (order.status !== "pending") {
    return {
      ok: false,
      code: "EXPIRED",
      error: `订单状态是 ${order.status}，不能认领`,
    }
  }

  if (params.reportedAmount !== undefined) {
    const reportedFen = toFen(params.reportedAmount)
    if (reportedFen === null || reportedFen !== order.amountFen) {
      return {
        ok: false,
        code: "AMOUNT_MISMATCH",
        error: `订单金额不匹配：期望 ${order.amountFen} 分，回调 ${String(params.reportedAmount)}`,
      }
    }
  }

  if (order.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: "EXPIRED", error: "订单已过期" }
  }

  const claimed = await db.transaction(async (tx) => {
    // 幂等闸门：只有还停在 pending 的那一行能被认领。
    const rows = await tx
      .update(subscriptionOrders)
      .set({
        status: "paid",
        paidAt: new Date(),
        updatedAt: new Date(),
        webhookReceived: true,
        // 理由并进留档：重复投递会覆盖它，而"最后一次是什么原因"才是排障要看的。
        webhookData: {
          ...(params.webhookData ?? order.webhookData ?? {}),
          settleReason: params.reason,
        },
        transactionId: params.transactionId ?? order.transactionId,
      })
      .where(
        and(
          eq(subscriptionOrders.id, order.id),
          eq(subscriptionOrders.status, "pending")
        )
      )
      .returning({ id: subscriptionOrders.id })
    if (rows.length === 0) return null

    const [existing] = await tx
      .select({ activeUntil: userSubscriptions.activeUntil })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, order.userId),
          eq(userSubscriptions.plan, order.plan)
        )
      )
      .limit(1)

    const now = new Date()
    const base =
      existing && existing.activeUntil.getTime() > now.getTime()
        ? existing.activeUntil
        : now
    const activeUntil = addCycle(base, order.cycle)

    const [row] = await tx
      .insert(userSubscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: order.userId,
        plan: order.plan,
        activeUntil,
        sourceOrderId: order.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userSubscriptions.userId, userSubscriptions.plan],
        set: {
          activeUntil,
          sourceOrderId: order.id,
          updatedAt: now,
        },
      })
      .returning({ activeUntil: userSubscriptions.activeUntil })

    return { activeUntil: row?.activeUntil ?? activeUntil }
  })

  if (claimed === null) {
    // 认领落败：要么另一个回调（或同一次投递的重试）先开通了，要么行在事务窗口里
    // 被过期清理改成了 `expired`。区分这两者——前者是正常幂等，后者是不能当没看见
    // 的"钱可能被扣了"。
    const [current] = await db
      .select({ status: subscriptionOrders.status })
      .from(subscriptionOrders)
      .where(eq(subscriptionOrders.id, order.id))
      .limit(1)

    if (!current || current.status !== "paid") {
      return {
        ok: false,
        code: "EXPIRED",
        error: `订单状态是 ${current?.status ?? "缺失"}，不能认领`,
      }
    }

    const existing = await readSubscription(order.userId, order.plan)
    return {
      ok: true,
      alreadySettled: true,
      orderId: order.id,
      activeUntil: existing?.activeUntil ?? order.paidAt ?? new Date(),
    }
  }

  return {
    ok: true,
    alreadySettled: false,
    orderId: order.id,
    activeUntil: claimed.activeUntil,
  }
}

/**
 * 把一张 pending 且已过期的订单标记为 `expired`。
 *
 * 只清理真过期的（条件里带 `expires_at < now()`），所以它对一张刚建的单是空操作。
 * `paid` 的单不会被它碰到——把一笔真收到的钱改写成"过期"是要人工核对的事，
 * 不能由一次例行清理顺手做掉。
 */
export async function expireStaleOrders(userId: string): Promise<void> {
  await db
    .update(subscriptionOrders)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(subscriptionOrders.userId, userId),
        eq(subscriptionOrders.status, "pending"),
        sql`${subscriptionOrders.expiresAt} < now()`
      )
    )
}
