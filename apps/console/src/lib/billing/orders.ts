/**
 * 建单与查单。
 *
 * 一次结账要拿到两样东西：微信的 `code_url`，以及把它画出来的图。前者要走一次
 * 外部网络调用（`/v3/pay/transactions/native`），后者是纯计算——所以两者在
 * `createSubscriptionOrder` 里一次做完，客户端只有一个往返。
 *
 * **复用 pending 订单**是这里最要紧的一条行为：用户关掉弹窗又打开、点了月付又点
 * 年付再点回月付、支付页刷新，都会再调一次 `createOrder`。每次都向微信开一张新单，
 * 会让同一个账号在商户后台留下一串孤儿订单，而用户手里那张二维码还在倒计时。
 * 所以同人同档同周期的未过期 pending 单直接复用，只有换了档位或等它过期才新开。
 */
import { and, desc, eq, gt, isNotNull } from "drizzle-orm"
import { db } from "@/db/client"
import { subscriptionOrders } from "@/db/schema/billing"
import { qrImageDataUrl } from "@/lib/billing/qr"
import { getActiveSubscription } from "@/lib/billing/subscriptions"
import {
  ORDER_TTL_MS,
  newOrderId,
  priceFor,
  renewalPriceFor,
  type SubscriptionCycle,
  type SubscriptionPlan,
} from "@/lib/billing/plans"
import { expireStaleOrders } from "@/lib/billing/settle"
import { SITE_ORIGIN } from "@/lib/config/site"
import { getGateway, isGatewayConfigured, isSimulationMode } from "@/lib/payment/gateway"

/** 结账弹窗要渲染的全部内容。`qrDataUrl` 已经是可以直接进 `<img src>` 的串。 */
export interface CheckoutOrder {
  orderId: string
  plan: SubscriptionPlan
  cycle: SubscriptionCycle
  amountFen: number
  /** 这张单是不是生效期内续费（金额已按 `RENEWAL_RATE` 折算）。 */
  renewal: boolean
  qrPayload: string
  qrDataUrl: string
  expiresAt: Date
  /** 开发期的模拟网关在跑。界面据此决定要不要显示「模拟支付」按钮。 */
  simulation: boolean
}

/** 凭据没配齐。调用方把它翻译成「支付暂未开放」，而不是 500。 */
export class PaymentNotConfiguredError extends Error {
  constructor() {
    super("payment gateway is not configured")
    this.name = "PaymentNotConfiguredError"
  }
}

const SUBJECT: Record<SubscriptionCycle, string> = {
  monthly: "OpenMCP 雷达 Pro 持续监控（月付）",
  yearly: "OpenMCP 雷达 Pro 持续监控（年付）",
}

export async function createSubscriptionOrder(params: {
  userId: string
  plan: SubscriptionPlan
  cycle: SubscriptionCycle
}): Promise<CheckoutOrder> {
  if (!isGatewayConfigured()) throw new PaymentNotConfiguredError()

  // 顺手结清上一张：不这么做的话，反复开关弹窗会攒下一把 pending 单，
  // 而"我还有没有在途订单"这个问题就得按时间倒序自己挑。
  await expireStaleOrders(params.userId)

  const reusable = await findReusableOrder(params.userId, params.plan, params.cycle)
  if (reusable) {
    return {
      ...reusable,
      qrDataUrl: await qrImageDataUrl(reusable.qrPayload),
      simulation: isSimulationMode(),
    }
  }

  // 续费 = 下单时刻仍有生效订阅。判定只在这里发生一次——金额、订单标志、后续的
  // 核价都用同一个答案。到期后再买是重新开通，走原价。
  const renewal = (await getActiveSubscription(params.userId)) !== null
  const amountFen = renewal
    ? renewalPriceFor(params.plan, params.cycle)
    : priceFor(params.plan, params.cycle)
  const orderId = newOrderId()
  const now = Date.now()

  await db.insert(subscriptionOrders).values({
    id: orderId,
    userId: params.userId,
    plan: params.plan,
    cycle: params.cycle,
    amountFen,
    renewal,
    status: "pending",
    channel: "wechat",
    expiresAt: new Date(now + ORDER_TTL_MS),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  })

  let qrPayload: string
  let expiresAt = new Date(now + ORDER_TTL_MS)
  try {
    const session = await getGateway().createTopUp({
      orderId,
      amount: (amountFen / 100).toFixed(2),
      currency: "CNY",
      subject: SUBJECT[params.cycle],
      origin: SITE_ORIGIN,
    })
    if (!session.qrPayload) throw new Error("gateway returned no code_url")
    qrPayload = session.qrPayload
    if (session.expiresAt) expiresAt = session.expiresAt
  } catch (error) {
    // 网关下单失败的订单永远等不到回调，留着 pending 只会让下次复用捡到一张
    // 没有码的单。关掉它，让下一次重试从干净状态开始。
    await db
      .update(subscriptionOrders)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(subscriptionOrders.id, orderId))
    console.error("[billing] wechat pre-create failed", orderId, error)
    throw error
  }

  await db
    .update(subscriptionOrders)
    .set({ qrPayload, expiresAt, updatedAt: new Date() })
    .where(eq(subscriptionOrders.id, orderId))

  return {
    orderId,
    plan: params.plan,
    cycle: params.cycle,
    amountFen,
    renewal,
    qrPayload,
    qrDataUrl: await qrImageDataUrl(qrPayload),
    expiresAt,
    simulation: isSimulationMode(),
  }
}

/** 同人同档同周期、还没过期、手里还有码的 pending 单。 */
async function findReusableOrder(
  userId: string,
  plan: SubscriptionPlan,
  cycle: SubscriptionCycle
) {
  const [row] = await db
    .select({
      id: subscriptionOrders.id,
      plan: subscriptionOrders.plan,
      cycle: subscriptionOrders.cycle,
      amountFen: subscriptionOrders.amountFen,
      renewal: subscriptionOrders.renewal,
      qrPayload: subscriptionOrders.qrPayload,
      expiresAt: subscriptionOrders.expiresAt,
    })
    .from(subscriptionOrders)
    .where(
      and(
        eq(subscriptionOrders.userId, userId),
        eq(subscriptionOrders.plan, plan),
        eq(subscriptionOrders.cycle, cycle),
        eq(subscriptionOrders.status, "pending"),
        isNotNull(subscriptionOrders.qrPayload),
        gt(subscriptionOrders.expiresAt, new Date())
      )
    )
    .orderBy(desc(subscriptionOrders.createdAt))
    .limit(1)

  if (!row || !row.qrPayload) return null
  return {
    orderId: row.id,
    plan: row.plan,
    cycle: row.cycle,
    amountFen: row.amountFen,
    renewal: row.renewal,
    qrPayload: row.qrPayload,
    expiresAt: row.expiresAt,
  }
}
