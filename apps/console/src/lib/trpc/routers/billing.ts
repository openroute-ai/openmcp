/**
 * 付费订阅的 tRPC 端点。
 *
 * 四个端点，两类：
 *
 * - **public**：`checkoutConfig`。价目表本来就印在落地页上，`simulation` 只在开发
 *   环境为真，两个都没有保密的理由——把价格放在客户端可见的地方，是为了让弹窗在
 *   建单之前就能显示金额，而不是先建了单才知道多少钱。
 * - **protected**：`createOrder` / `checkStatus` / `getMySubscription`。钱和权益都
 *   挂在 `ctx.session.user.id` 上，订单查询的归属条件写在 SQL 里而不是读出来再比。
 *
 * 金额**从不**来自入参。客户端只说"我要月付的 Pro"，多少年由服务端的价目表回答
 * （`lib/billing/plans.ts`）——一个能传金额的下单接口等于把定价权交给了浏览器。
 *
 * 结算不在这里：微信回调走 `/api/webhook/wechat`，那条路径不经过 tRPC，因为网关
 * 不带 cookie，也永远不该带。
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  lte,
  or,
  type SQL,
} from "drizzle-orm"
import { user } from "@/db/schema"
import {
  subscriptionOrders,
  userSubscriptions,
  ORDER_STATUSES,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_PLANS,
} from "@/db/schema/billing"
import {
  PaymentNotConfiguredError,
  createSubscriptionOrder,
} from "@/lib/billing/orders"
import { planCatalog } from "@/lib/billing/plans"
import { isGatewayConfigured, isSimulationMode } from "@/lib/payment/gateway"
import { ERROR_CODES } from "@/lib/trpc/error-codes"
import {
  createTRPCRouter,
  adminProcedure,
  protectedProcedure,
  publicProcedure,
} from "../init"

const plan = z.enum(SUBSCRIPTION_PLANS)
const cycle = z.enum(SUBSCRIPTION_CYCLES)

/** Rows per page. An operator scans these tables, does not read them whole. */
const PAGE_SIZE = 20

/** An escaped `LIKE` needle, reused so a search with `%` stays a literal. */
const needle = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`

export const billingRouter = createTRPCRouter({
  /**
   * 结账前要显示的东西：价目表 + 支付通道状态。
   *
   * `gatewayConfigured` 让界面在**建单之前**就能说"支付暂未开放"，而不是点了按钮
   * 收到 500 才知道商户号没配。
   */
  checkoutConfig: publicProcedure.query(() => ({
    prices: planCatalog(),
    simulation: isSimulationMode(),
    gatewayConfigured: isGatewayConfigured(),
  })),

  /** 我的订阅。过期的不返回——`activeUntil` 已经是全部语义，过期等于没有。 */
  getMySubscription: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        plan: userSubscriptions.plan,
        activeUntil: userSubscriptions.activeUntil,
      })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, ctx.session.user.id),
          gt(userSubscriptions.activeUntil, new Date())
        )
      )
      .limit(1)

    return row ?? null
  }),

  /**
   * 建单（或复用一张还没过期的）。返回二维码与倒计时，弹窗直接渲染。
   *
   * 同档同周期的 pending 单会被复用，所以这个 mutation 对"用户又点了一次"是安全
   * 的——见 `lib/billing/orders.ts` 文件头。
   */
  createOrder: protectedProcedure
    .input(z.object({ plan, cycle }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createSubscriptionOrder({
          userId: ctx.session.user.id,
          plan: input.plan,
          cycle: input.cycle,
        })
      } catch (error) {
        if (error instanceof PaymentNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "payment gateway is not configured",
            cause: { code: ERROR_CODES.paymentNotConfigured },
          })
        }
        console.error("[billing] createOrder failed", error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "failed to create the order",
          cause: { code: ERROR_CODES.orderCreateFailed },
        })
      }
    }),

  /**
   * 轮询一张订单的状态。归属条件带 `userId`，所以拿别人的订单号来轮询只会得到
   * `NOT_FOUND`——这正是要的答案：那张单不属于你。
   */
  checkStatus: protectedProcedure
    .input(z.object({ orderId: z.string().trim().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const [order] = await ctx.db
        .select({
          id: subscriptionOrders.id,
          status: subscriptionOrders.status,
          plan: subscriptionOrders.plan,
          cycle: subscriptionOrders.cycle,
          amountFen: subscriptionOrders.amountFen,
          renewal: subscriptionOrders.renewal,
          expiresAt: subscriptionOrders.expiresAt,
          paidAt: subscriptionOrders.paidAt,
        })
        .from(subscriptionOrders)
        .where(
          and(
            eq(subscriptionOrders.id, input.orderId),
            eq(subscriptionOrders.userId, ctx.session.user.id)
          )
        )
        .limit(1)

      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "order not found" })
      }

      if (order.status !== "paid") {
        return { ...order, activeUntil: null }
      }

      const [subscription] = await ctx.db
        .select({ activeUntil: userSubscriptions.activeUntil })
        .from(userSubscriptions)
        .where(
          and(
            eq(userSubscriptions.userId, ctx.session.user.id),
            eq(userSubscriptions.plan, order.plan)
          )
        )
        .limit(1)

      return { ...order, activeUntil: subscription?.activeUntil ?? null }
    }),

  /**
   * 我自己的付款账本：`subscription_orders` 里归属于我的行。
   *
   * 与 `listOrders` 相对——那边是管理员的全表视图，这里是"这笔单是我的"，所以
   * 归属条件写在 SQL 里（`user_id = session.user.id`），而不是取回来再筛。列的
   * 形状刻意与 `checkStatus` 对齐：同样读的是订单快照，历史与在途不设两套字段。
   */
  myOrders: protectedProcedure
    .input(
      z.object({
        status: z.enum(["all", ...ORDER_STATUSES] as const).default("all"),
        limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = [
        eq(subscriptionOrders.userId, ctx.session.user.id),
      ]
      if (input.status !== "all") {
        conditions.push(eq(subscriptionOrders.status, input.status))
      }
      const where = and(...conditions)

      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            id: subscriptionOrders.id,
            plan: subscriptionOrders.plan,
            cycle: subscriptionOrders.cycle,
            amountFen: subscriptionOrders.amountFen,
            renewal: subscriptionOrders.renewal,
            status: subscriptionOrders.status,
            channel: subscriptionOrders.channel,
            paidAt: subscriptionOrders.paidAt,
            createdAt: subscriptionOrders.createdAt,
            expiresAt: subscriptionOrders.expiresAt,
          })
          .from(subscriptionOrders)
          .where(where)
          .orderBy(desc(subscriptionOrders.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(subscriptionOrders)
          .where(where)
          .then((rows) => rows[0]),
      ])

      return {
        items: rows,
        total: Number(counted?.value ?? 0),
      }
    }),

  /**
   * 谁在付费：`user_subscriptions` 全表（管理员视图）。
   *
   * 与 `getMySubscription` 相对——那里只回答"我有没有"，这里回答"所有人现在
   * 什么状态"。权益没有中间态：`activeUntil` 揭开系统时钟的当下就是全部状态，
   * 所以 `state` 过滤直接在 SQL 里减去 now，不是先拉回来再筛。
   *
   * `adminProcedure`：行的 `userId` 引着账号名与邮箱，这和账号列表一样只给
   * 管理员看——钱账里的归属不是公开信息，而表里每一行都含归属。
   */
  listSubscriptions: adminProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        state: z.enum(["all", "active", "expired"]).default("all"),
        limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = []

      const term = input.search?.trim()
      if (term) {
        const pattern = needle(term)
        conditions.push(
          or(
            ilike(user.name, pattern),
            ilike(user.email, pattern),
            ilike(userSubscriptions.userId, pattern)
          )!
        )
      }

      const now = new Date()
      if (input.state === "active") {
        conditions.push(gt(userSubscriptions.activeUntil, now))
      } else if (input.state === "expired") {
        conditions.push(lte(userSubscriptions.activeUntil, now))
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            userId: userSubscriptions.userId,
            plan: userSubscriptions.plan,
            activeUntil: userSubscriptions.activeUntil,
            sourceOrderId: userSubscriptions.sourceOrderId,
            updatedAt: userSubscriptions.updatedAt,
            userName: user.name,
            userEmail: user.email,
          })
          .from(userSubscriptions)
          .leftJoin(user, eq(user.id, userSubscriptions.userId))
          .where(where)
          .orderBy(desc(userSubscriptions.activeUntil))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(userSubscriptions)
          .leftJoin(user, eq(user.id, userSubscriptions.userId))
          .where(where)
          .then((rows) => rows[0]),
      ])

      // One `now`, shared by the filter and every row, so "生效中" and the
      // border case agree instead of straddling a millisecond.
      return {
        items: rows.map((row) => ({ ...row, active: row.activeUntil > now })),
        total: Number(counted?.value ?? 0),
      }
    }),

  /**
   * 付款账本：`subscription_orders` 全表（管理员视图）。
   *
   * 每条记录都是钱本身——订单号、金额、渠道、回调——所以这一层天然只给管理员
   * （`adminProcedure`），并且**只读**：关单、标记状态永远是结算程序的事，控制台
   * 从不直接改写一行钱账，报表只管看。
   *
   * 与订阅视图同框是刻意的：两张表一份账，运营在同一个页面里对齐"谁付了"
   * 和"付的结果"。状态过滤和搜索直接下推到 SQL。
   */
  listOrders: adminProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        status: z.enum(["all", ...ORDER_STATUSES] as const).default("all"),
        limit: z.number().int().min(1).max(100).default(PAGE_SIZE),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = []

      const term = input.search?.trim()
      if (term) {
        const pattern = needle(term)
        conditions.push(
          or(
            ilike(subscriptionOrders.id, pattern),
            ilike(user.name, pattern),
            ilike(user.email, pattern)
          )!
        )
      }

      if (input.status !== "all") {
        conditions.push(eq(subscriptionOrders.status, input.status))
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            id: subscriptionOrders.id,
            plan: subscriptionOrders.plan,
            cycle: subscriptionOrders.cycle,
            amountFen: subscriptionOrders.amountFen,
            /** 生效期内续费的单（金额已 8 折）。对账时一眼看出为什么比价目表少。 */
            renewal: subscriptionOrders.renewal,
            status: subscriptionOrders.status,
            channel: subscriptionOrders.channel,
            paidAt: subscriptionOrders.paidAt,
            createdAt: subscriptionOrders.createdAt,
            expiresAt: subscriptionOrders.expiresAt,
            userId: subscriptionOrders.userId,
            userName: user.name,
            userEmail: user.email,
          })
          .from(subscriptionOrders)
          .leftJoin(user, eq(user.id, subscriptionOrders.userId))
          .where(where)
          .orderBy(desc(subscriptionOrders.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(subscriptionOrders)
          .leftJoin(user, eq(user.id, subscriptionOrders.userId))
          .where(where)
          .then((rows) => rows[0]),
      ])

      return {
        items: rows,
        total: Number(counted?.value ?? 0),
      }
    }),
})
