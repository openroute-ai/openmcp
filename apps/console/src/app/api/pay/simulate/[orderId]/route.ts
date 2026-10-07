import { type NextRequest, NextResponse } from "next/server"
import { eq, and } from "drizzle-orm"
import { db } from "@/db/client"
import { subscriptionOrders } from "@/db/schema/billing"
import { settleSubscriptionOrder } from "@/lib/billing/settle"
import { getSimulatedGateway, isSimulationMode } from "@/lib/payment/gateway"
import { getFullSessionUser } from "@/lib/auth/session"

/**
 * 开发期的微信回调替身。
 *
 * 微信要通知一台它能到达的服务器，而笔记本不是一个公网端点。这条路由让整条链路
 * 本地可跑：它铸造一份模拟网关签名的回调，**先过网关自己的 `verifyCallback`**，
 * 再进与生产完全相同的 `settleSubscriptionOrder`。
 *
 * 它不是后门。签名照样验，金额照样与订单核对，开通照样幂等——唯一的区别是谁签的名。
 *
 * 三重门：`PAYMENT_SIMULATE=false` 或生产构建直接 404；模拟网关构造时会再抛一次；
 * 会话必须属于这张订单，所以本地的另一个人也不能结算你的单。
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  if (!isSimulationMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const { orderId } = await params
    const body = (await request.json().catch(() => ({}))) as {
      outcome?: "success" | "fail"
      /** 故意发一个错的金额，用来验证金额不符这条路真的挡得住。 */
      amountOverride?: string
    }

    const user = await getFullSessionUser()
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const [order] = await db
      .select({
        id: subscriptionOrders.id,
        userId: subscriptionOrders.userId,
        amountFen: subscriptionOrders.amountFen,
        status: subscriptionOrders.status,
        expiresAt: subscriptionOrders.expiresAt,
      })
      .from(subscriptionOrders)
      .where(
        and(
          eq(subscriptionOrders.id, orderId),
          eq(subscriptionOrders.userId, user.id)
        )
      )
      .limit(1)

    if (!order) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 })
    }
    if (order.status === "paid") {
      return NextResponse.json({ success: true, alreadySettled: true, orderId })
    }

    if (body.outcome === "fail") {
      // 一笔被拒付的支付：订单保持未支付，权益不变化。
      return NextResponse.json({
        success: true,
        settled: false,
        reason: "支付失败（模拟）",
      })
    }

    const reportedAmount = body.amountOverride ?? (order.amountFen / 100).toFixed(2)
    const { payload, signature } = getSimulatedGateway().issueCallback(
      orderId,
      reportedAmount
    )

    // 与生产同一条路径：先验签，再结算。
    const verified = await getSimulatedGateway().verifyCallback(payload, signature)
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }

    const settlement = await settleSubscriptionOrder({
      orderId,
      reason: "dev_simulated",
      reportedAmount: verified.callback.amount,
      transactionId: verified.callback.transactionId,
      webhookData: { simulated: true, raw: verified.callback },
    })

    if (!settlement.ok) {
      return NextResponse.json(
        { success: false, code: settlement.code, error: settlement.error },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      settled: !settlement.alreadySettled,
      alreadySettled: settlement.alreadySettled,
      orderId: settlement.orderId,
      activeUntil: settlement.activeUntil,
    })
  } catch (error) {
    console.error("[simulate-payment] failed", error)
    return NextResponse.json({ error: "模拟支付失败" }, { status: 500 })
  }
}
