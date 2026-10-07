/**
 * 付费订阅的订单与权益（`docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md` §6.1、§12.2 待决 6）。
 *
 * 两张表，回答两个问题：这笔钱收没收（`subscription_orders`），这个账号现在有没有
 * 权益（`user_subscriptions`）。分开而不是一张表，是因为两者的生命周期不同——订单
 * 是一次性的、永久留档的流水，权益是会被续费不断延长的当前状态；把 `activeUntil`
 * 放进订单里，会让"查我订阅到几号"变成"按时间倒序扫一遍所有已支付订单再取最大值"。
 *
 * 与 `subscriptions`（§6.1，webhook 数据推送）**没有关系**：那张表叫订阅是因为它推
 * 数据，这张叫订阅是因为收了钱。名字撞了是既成事实，域不撞——本文件的表一律以
 * `subscription_` / `user_` 前缀区分。
 *
 * 金额一律存**分**（整数）：`¥99.00` 是 `9900`。元字符串在两处计算（服务端白名单、
 * 网关回调）就会出现 `0.1 + 0.2`，而钱上没有"差不多"。
 *
 * 决策 #7：雷达自建收单，不经手 web 的 `rechargeOrders` / `balances`——两张表分属
 * 两个数据库，本表只存在于 `CONSOLE_DATABASE_URL`。
 */
import { relations } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_PLANS,
  type SubscriptionCycle,
  type SubscriptionPlan,
} from "@/lib/billing/plan-types"
import { user } from "../schema"

/**
 * 档位与周期定义在 `lib/billing/plan-types.ts`（那里没有 drizzle，客户端要读），
 * 这里只是转手：schema 的 `$type<>` 要它们，而调用方多数已经在从本模块取表定义。
 */
export { SUBSCRIPTION_CYCLES, SUBSCRIPTION_PLANS }
export type { SubscriptionCycle, SubscriptionPlan }

/**
 * 订单状态。四个值，不是三个：
 *
 * `pending` → `paid` 是正常路径；`expired` 是二维码过了 `expires_at` 没人扫；
 * `closed` 留给"建了单但网关下单失败/主动放弃"的终态。少了后两个，"我那笔钱到底
 * 还能不能付"这个问题只能靠 `paid_at is null` 反答，而那会把"二维码过期了"和
 * "网关拒绝了"混成一个状态。
 */
export const ORDER_STATUSES = ["pending", "paid", "expired", "closed"] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const subscriptionOrders = pgTable(
  "subscription_orders",
  {
    /** 商户侧订单号，同时是微信的 `out_trade_no`。生成规则见 `lib/billing/plans.ts`。 */
    id: text("id").primaryKey(),

    /** 下单人。`CASCADE`：账号注销，未支付的订单没有留着的理由。 */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    plan: text("plan").$type<SubscriptionPlan>().notNull(),
    cycle: text("cycle").$type<SubscriptionCycle>().notNull(),

    /** 应付金额，**分**。服务端白名单算出，客户端传不进来。 */
    amountFen: integer("amount_fen").notNull(),

    /**
     * 这笔单是不是生效期内续费（打了 8 折）。
     *
     * 金额里没有"为什么是这么多"——续费价和原价都是整数分，光看 `amount_fen` 分不清
     * 付的是哪一档。一列把"下单时有生效订阅"这个事实留在钱账里，对账时才不必回推
     * 定价规则。判定发生在建单时刻：下单时 `activeUntil` 已过就是原价，哪怕几分钟后
     * 他又续上了。
     */
    renewal: boolean("renewal").notNull().default(false),

    status: text("status").$type<OrderStatus>().notNull().default("pending"),

    /** 目前恒为 `wechat`。留列是为了回调按渠道路由，而不是因为有第二个渠道。 */
    channel: text("channel").notNull().default("wechat"),

    /** 网关返回的 `code_url`，前端拿去画二维码。不是凭据，泄露也换不来这笔钱。 */
    qrPayload: text("qr_payload"),

    /** 微信的 `transaction_id`。对账与排障的唯一凭据。 */
    transactionId: text("transaction_id"),

    /**
     * 回调是否收到过。
     *
     * 与 `status = 'paid'` 分开存：状态是"这笔订单现在怎么样"，这一列是"我们收没
     * 收到过网关通知"。一条签名合法但业务被拒的回调要能留下痕迹，否则排障时分不清
     * "没通知"和"通知了但金额不对"。
     */
    webhookReceived: boolean("webhook_received").notNull().default(false),

    /** 回调原文（已解密的交易信息）。只读留档，没有任何逻辑读它。 */
    webhookData: jsonb("webhook_data").$type<Record<string, unknown>>(),

    /** 二维码有效期。过了它，`pending` 订单不能再被回调认领（`settle` 里检查）。 */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("subscription_orders_user_created_idx").on(table.userId, table.createdAt),
    index("subscription_orders_status_idx").on(table.status),
  ]
)

export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: text("id").primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    plan: text("plan").$type<SubscriptionPlan>().notNull(),

    /** 权益到此为止。续费从 `max(now, activeUntil)` 往后接，不覆盖。 */
    activeUntil: timestamp("active_until", { withTimezone: true }).notNull(),

    /** 最近一次续上它的订单。可空：订单被清理过之后这只是一个线索。 */
    sourceOrderId: text("source_order_id").references(
      () => subscriptionOrders.id,
      { onDelete: "set null" }
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 一个账号一个档位一行。没有它，两次并发回调会插出两行，"我的订阅到几号"
    // 就得自己挑一行——而挑哪一行取决于扫描顺序。
    uniqueIndex("user_subscriptions_user_plan_idx").on(table.userId, table.plan),
  ]
)

export const subscriptionOrderRelations = relations(subscriptionOrders, ({ one }) => ({
  user: one(user, {
    fields: [subscriptionOrders.userId],
    references: [user.id],
  }),
}))

export const userSubscriptionRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(user, {
    fields: [userSubscriptions.userId],
    references: [user.id],
  }),
  sourceOrder: one(subscriptionOrders, {
    fields: [userSubscriptions.sourceOrderId],
    references: [subscriptionOrders.id],
  }),
}))
