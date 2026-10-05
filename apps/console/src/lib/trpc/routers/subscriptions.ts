/**
 * 订阅的自助管理与管理员视图（设计文档 §6.7 / §6.8）。
 *
 * ## 两个页面，一个 router
 *
 * `/console/subscriptions` 是订阅方自己的入口，`/dashboard/subscriptions` 是管理员的
 * 治理入口，两者共用这里的六个 procedure 与同一个组件。区别只有两处，而且都是这个
 * router 内部决定的，不是页面决定的：
 *
 * - **归属**：`listMine` / `create` / `update` / `remove` / `rotateSecret` /
 *   `sendTest` 全部按 `{ userId: session.user.id }` 读写，而归属过滤发生在服务层的
 *   SQL 里（`ownerCondition`）。页面没有一处权限判断，因为页面是最容易漏检查的地方。
 * - **管理员多一档**：`list` 与 `detail` 是 `protectedProcedure` 而不是
 *   `adminProcedure`——它们对管理员看全部、对普通用户看自己的，正是 §2.4 那个"角色推进
 *   WHERE"模式。管理员真正独有的动作只有 `disable`（§6.7 为什么必须有它：用户可以把
 *   `callbackUrl` 指向任意外部地址然后订全量，而用户不会主动取消）。
 *
 * ## 管理员不能改什么
 *
 * 过滤器、`callbackUrl`、scopes 在 admin 侧一律不可写，只有 `enabled`。那些字段是订阅方
 * 的意图而不是运营的：管理员替别人改过滤器，会让对方下次投递到的数据形状与他自己配的
 * 不一致，而这件事没有任何记录能解释。
 *
 * ## 明文
 *
 * 签名密钥明文只在 `create` 与 `rotateSecret` 的响应里出现一次，之后任何 procedure 都不
 * 返回它——库里只有 `sha256(明文)`。列表因此只能显示 `secretPrefix` 那 4 位。
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { sql } from "drizzle-orm"
import { subscriptions } from "@/db/schema/subscriptions"
import { clientIpFromHeaders, writeApiAudit } from "@/lib/api/audit"
import {
  subscriptionRequestSchema,
  subscriptionUpdateSchema,
} from "@/lib/api/contract"
import {
  createSubscription,
  deleteSubscription,
  findSubscriptionById,
  getSubscriptionDetail,
  listAllSubscriptions,
  listSubscriptions,
  ownerOf,
  rotateSubscriptionSecret,
  toSubscriptionView,
  updateSubscription,
} from "@/lib/api/subscriptions"
import { sendTestDelivery } from "@/lib/api/subscription-delivery"
import { adminProcedure, createTRPCRouter, protectedProcedure } from "../init"

/**
 * 探测投递的日志去向。
 *
 * 与任务 runner 的 `createBufferingLogger` 不同：它是一次 HTTP 调用，不是一次任务运行，
 * 所以没有"把这段日志存进 `task_logs` 再关联一个 run"可言——写进 console 就够，
 * 而排障的人看的是订阅自己的 `lastError` 与投递历史，不是这个。
 */
const deliveryLogger = {
  info: (message: string, meta?: Record<string, unknown>) =>
    console.info(message, meta ?? {}),
  warn: (message: string, meta?: Record<string, unknown>) =>
    console.warn(message, meta ?? {}),
  error: (message: string, meta?: Record<string, unknown>) =>
    console.error(message, meta ?? {}),
}

/** 与 `routers/connections.ts` 同一个形状：不是我的就是不存在。 */
function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "No such subscription" })
}

export const subscriptionsRouter = createTRPCRouter({
  // ────────────────────────────── 自助 ──────────────────────────────

  /**
   * 我自己的订阅。
   *
   * 没有 `enabled` 之类的过滤参数：这个列表就是"我配过什么"，而"停用的那些要不要藏
   * 起来"是一个页面问题——藏起来之后读者会以为订阅消失了，而它只是暂停着，投递队列
   * 还留着。
   */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    return listSubscriptions(ctx.db, { userId: ctx.session.user.id })
  }),

  /** 建订阅。签名密钥明文**只**出现在这一次响应里。 */
  create: protectedProcedure
    .input(subscriptionRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const { row, secret } = await createSubscription(
        ctx.db,
        { userId: ctx.session.user.id },
        input
      )

      return { ...toSubscriptionView(row), secret }
    }),

  /**
   * 改订阅。
   *
   * `filters` 命中时服务层会在同一个事务里给 `filters_version` 加一，并把水位线**回退**
   * 到新命中集合的最早已存周期（§6.4）——否则这次新纳入的仓库因为历史早于水位线而永远
   * 收不到。返回的是更新后的整行，所以页面刷新后能确认这次改动真的被记住了。
   */
  update: protectedProcedure
    .input(
      subscriptionUpdateSchema.extend({ id: z.string().min(1) })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      const updated = await updateSubscription(
        ctx.db,
        { userId: ctx.session.user.id },
        id,
        patch
      )
      if (!updated) notFound()

      return toSubscriptionView(updated)
    }),

  /**
   * 取消订阅。
   *
   * 队列随 `webhook_deliveries.subscription_id` 的 CASCADE 一起消失，所以取消之后不会有
   * 任何残留的重试再打出去——这是"取消"必须删行而不是置 `enabled = false` 的原因，
   * 后者是"暂停"，两件事在这里刻意只给前者。
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const removed = await deleteSubscription(
        ctx.db,
        { userId: ctx.session.user.id },
        input.id
      )
      if (!removed) notFound()

      return { ok: true, id: input.id }
    }),

  /** 轮换签名密钥。旧的**立刻**失效，没有宽限期（见服务层的理由）。 */
  rotateSecret: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rotated = await rotateSubscriptionSecret(
        ctx.db,
        { userId: ctx.session.user.id },
        input.id
      )
      if (!rotated) notFound()

      return rotated
    }),

  /**
   * 发一条探测事件（§6.8）：地址可达吗、签名过吗、按我想的过滤器命中了吗。
   *
   * **不推进水位线**——它是探测而不是补数据，推进了会让下一次正常投递从探测那一刻算起，
   * 于是"点一下测试"这个只读动作吞掉一段增量数据。
   *
   * 只有订阅方自己点得了：管理员替别人发探测，就是拿管理员的会话去打一个用户的端点，
   * 而那条投递记录会写进用户的排障历史里，让人以为自己的回调刚坏过。
   */
  sendTest: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await findSubscriptionById(ctx.db, input.id)
      // 归属过滤先于任何读取：拿不到就是不存在，而不是 403。
      if (!row || row.userId !== ctx.session.user.id) notFound()

      return sendTestDelivery(ctx.db, row, new Date(), deliveryLogger)
    }),

  // ────────────────────────────── 管理员 ──────────────────────────────

  /**
   * 全部订阅，两种归属都看。
   *
   * `protectedProcedure` 而不是 `adminProcedure`：这一族 procedure 里只有 `disable` 是
   * 管理员动作，列表与详情对普通用户等价于自助那一份（§2.4 的"角色推进 WHERE"）。
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.user.role !== "admin") {
      return listSubscriptions(ctx.db, { userId: ctx.session.user.id })
    }

    return listAllSubscriptions(ctx.db)
  }),

  /**
   * 订阅详情：契约的订阅对象加上排障字段（命中仓库数、水位线、最近 20 条投递）。
   *
   * 管理员这一支先按 id 读行、再用行自己的归属去读详情，于是租户过滤仍然只由
   * `ownerCondition` 实现一次，而不是"读出来之后在内存里比一下 userId"。
   */
  detail: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (ctx.session.user.role !== "admin") {
        const detail = await getSubscriptionDetail(
          ctx.db,
          { userId: ctx.session.user.id },
          input.id
        )
        if (!detail) notFound()
        return detail
      }

      const row = await findSubscriptionById(ctx.db, input.id)
      if (!row) notFound()
      const detail = await getSubscriptionDetail(ctx.db, ownerOf(row), row.id)
      if (!detail) notFound()

      return { ...detail, apiKeyId: row.apiKeyId, userId: row.userId }
    }),

  /**
   * 管理员停用别人的订阅（§6.7）。
   *
   * 与"连续失败熔断"是两回事，所以 `disabled_reason` 写 `admin` 而不是复用前者：排障时
   * 要能分开"对方自己的端点坏了"和"我们把它关了"。
   *
   * 已停用的跳过：再写一次会把"什么时候被关的"冲成一个更晚的时间，而审计行要回答的
   * 恰恰是那一刻。恢复由订阅方自己在 `/console/subscriptions` 做——管理员恢复别人的
   * 订阅，等于替他判断"现在应该开始给他发数据了"。
   */
  disable: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z.string().trim().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await findSubscriptionById(ctx.db, input.id)
      if (!row) notFound()

      return ctx.db.transaction(async (tx) => {
        const disabled = await tx
          .update(subscriptions)
          .set({
            enabled: false,
            disabledReason: "admin",
            updatedAt: sql`now()`,
          })
          .where(
            sql`${subscriptions.id} = ${input.id} and ${subscriptions.enabled}`
          )
          .returning({ id: subscriptions.id })

        if (disabled.length === 0) return { id: input.id, disabled: false }

        await writeApiAudit(tx, {
          // 审计的 `user_id` 记**操作者**，归属主体在订阅自己的 `user_id` /
          // `api_key_id` 两列里没被改动，排障时仍然看得到是谁的订阅被关了。
          userId: ctx.session.user.id,
          // 显式写 `null` 而不是省掉：这两个字段为 null 的含义是"这次动作与某把 key
          // 无关"，而省掉它们会让"忘了填"与"确实无关"在审计里长得一模一样。
          apiKeyId: null,
          keyPrefix: null,
          action: "subscription.disable",
          after: { subscriptionId: input.id, disabledReason: "admin" },
          reason: input.reason,
          ip: clientIpFromHeaders(ctx.headers),
        })

        return { id: input.id, disabled: true }
      })
    }),
})