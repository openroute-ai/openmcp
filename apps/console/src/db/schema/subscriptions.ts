/**
 * 订阅与投递日志（设计文档 §6.1）。
 *
 * 两张表，回答两个问题：订阅方要什么（`subscriptions`），以及它最后一次拿到数据的
 * 时候发生了什么（`webhook_deliveries`）。后者不是审计——审计是"谁改过凭据"，见
 * `api-request-audit.ts`——它是**投递队列本身**：batch 模式的 watermark 只在投递成功后
 * 推进，而重试要发同一份字节，所以 payload 必须落库。
 *
 * 过滤器**直接放在 `subscriptions` 上**而不是拆一张 `subscription_filters`：过滤条件
 * 一对一跟着订阅走，没有独立生命周期，也没有"多个订阅共享一个过滤器"的用法。拆表
 * 只会多一次 join 和一个需要级联删除的东西。
 *
 * 过滤器**不入库为 JSON**，而是一组带类型的数组列。理由是 `project_types` 要参与
 * `projects.type = ANY(...)` 的索引扫描，而 JSONB 里的数组做不到——过滤发生在每次推送
 * 时，不是一次性的。
 */
import { relations, sql } from "drizzle-orm"
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
import { user } from "../schema"
import { apiKeys } from "./api-keys"

/** 订阅推的周期。投递按它决定读哪张统计表。 */
export const SUBSCRIPTION_CADENCES = ["daily", "weekly", "monthly"] as const
export type SubscriptionCadence = (typeof SUBSCRIPTION_CADENCES)[number]

/**
 * 推什么内容。与 key 的 `scopes` 是两回事，见 `lib/api/contract.ts`。
 *
 * 刻意没有 `repos.user_repos`：那是订阅者自己的私有数据（`note` / `pinned` 等），
 * 只该在 console 读，**绝不随订阅推给任何回调地址**。
 */
export const SUBSCRIPTION_SCOPES = [
  "repos.stats",
  "repos.rankings",
  "repos.metadata",
] as const
export type SubscriptionScope = (typeof SUBSCRIPTION_SCOPES)[number]

/** 推增量还是推当前状态。 */
export const SUBSCRIPTION_MODES = ["batch", "snapshot"] as const
export type SubscriptionMode = (typeof SUBSCRIPTION_MODES)[number]

/** 为什么被停用。`admin` 与"连续失败熔断"是两回事，排障时要分开。 */
export const SUBSCRIPTION_DISABLED_REASONS = [
  "too_many_failures",
  "admin",
] as const
export type SubscriptionDisabledReason =
  (typeof SUBSCRIPTION_DISABLED_REASONS)[number]

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),

    /** 只给自己看的名字，多条订阅时分辨用。 */
    name: text("name").notNull(),

    /**
     * 签名用的那把 api key，**恒非空**。
     *
     * 投递签名不再由每条订阅自己生成一份密钥，而是从这把 key 的 `key_hash` 派生
     * （`deriveSigningKey`）：一个接入方只持有自己那把 key 就能验签，不必在 key 之外
     * 再存第二个凭据；同一把 key 名下的多个订阅共用同一个验签密钥。
     *
     * 它同时也是 v1 侧的归属主体（`/api/v1/subscriptions` 只列这把 key 名下的行），
     * 与下面的 `userId` 不冲突：`userId` 非空表示这条是 console 会话里建的，那一行
     * 仍然有一把 key 只是**用来签名**，归属判定走 `user_id is null` 的反面。
     */
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, {
        onDelete: "cascade",
      }),

    /**
     * console 会话里建的订阅才有的归属列，M2M（v1）建的为 NULL。
     *
     * 两种归属不再互斥：会话建的订阅既要记"谁建的"，也要有一把 key 来签名。
     * 服务层的 `ownerCondition` 因此按 `user_id is null` 区分两种列表，而不是靠
     * 两列的非空组合。
     */
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),

    callbackUrl: text("callback_url").notNull(),

    cadence: text("cadence").$type<SubscriptionCadence>().notNull().default("daily"),

    /** 推什么。`$type` 把 text 收窄成三个字面量，而不是建 pg_enum（加值要先改类型）。 */
    scopes: text("scopes").array().$type<SubscriptionScope[]>().notNull(),

    /**
     * 过滤器。语义与求值顺序见 §6.6，判定规则在 `lib/api/repo-filter.ts`。
     *
     * 数组默认 `{}`（空数组）而不是 NULL：NULL 会让"没给这个过滤器"与"给了空的"在
     * 每一处判断里都要分开处理，而空数组本身就能表达后者。
     */
    projectTypes: text("project_types")
      .array()
      .notNull()
      .default(sql<string[]>`'{}'::text[]`),
    categoryCodes: text("category_codes")
      .array()
      .notNull()
      .default(sql<string[]>`'{}'::text[]`),
    includePlatform: boolean("include_platform").notNull().default(true),
    includeUncurated: boolean("include_uncurated").notNull().default(true),
    includeOwnSubmissions: boolean("include_own_submissions")
      .notNull()
      .default(true),

    /**
     * 显式白名单。**NULL = 走上面的过滤器**，非空则完全覆盖它们（§6.6 规则 1）。
     *
     * 刻意可空：空数组与 NULL 是两个意思——空数组是"白名单是空的，一个都不推"，
     * 而那是用户的错；NULL 是"没给白名单"。
     */
    repoIds: text("repo_ids").array(),

    mode: text("mode").$type<SubscriptionMode>().notNull().default("batch"),

    /**
     * 过滤器每次变更 +1，消费方据此区分"新数据"与"过滤器变更后的补发"（§6.4）。
     *
     * **必须是列而不是运行时算的**：投递是异步的（cron 里跑），"这次投递对应哪一版
     * 过滤器"只有在 payload 组装的那一刻才能确定，而那时已经不在 HTTP 请求上下文里。
     */
    filtersVersion: integer("filters_version").notNull().default(1),

    enabled: boolean("enabled").notNull().default(true),

    /**
     * 已成功投递到的位置。**只有投递成功才推进**，失败不动，因此重试会重发同一批。
     *
     * 改过滤器时它会**回退**到新命中集合的最早已存周期（§6.4），好让新纳入的仓库
     * 至少被完整推一次；空命中集合时不推进也不回退。
     */
    watermark: timestamp("watermark", { withTimezone: true }),

    /** 连续失败计数，达到阈值熔断（§6.4）。任何一次成功都清零。 */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    disabledReason: text("disabled_reason").$type<SubscriptionDisabledReason>(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    lastError: text("last_error"),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // 「列出我的订阅」是唯一的管理入口，两种归属各一条。`api_key_id` 由
    // `NOT NULL` 约束住（它同时是签名 key），所以这里不再需要一条 CHECK 来
    // 挡"两列都空"——`api_key_id is null` 在新行上不可能发生。
    index("subscriptions_key_idx").on(table.apiKeyId),
    index("subscriptions_user_idx").on(table.userId),
    // 投递任务每轮扫这个索引；部分索引让它只覆盖真正在推的那些行。
    index("subscriptions_enabled_idx")
      .on(table.enabled)
      .where(sql`${table.enabled}`),
  ]
)

/**
 * 投递队列。
 *
 * **payload 存原文而不是重新序列化**：重试必须发同一份字节，否则 `eventId` 相同而
 * 签名不同，接收方的重放窗口（300s）会拒掉第二次。这也正是签名要覆盖 timestamp 的
 * 原因——一份被重发的 payload 必然对应一个新的 timestamp。
 *
 * `watermark` 也存一份：投递与推进水位线不是同一件事，中间可能失败，而"这批数据覆盖到
 * 哪一期"必须跟着这批数据一起重试。
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),

    /**
     * 幂等键：同一批的多次重试共用一个，重试时不变。消费方按它去重。
     *
     * 唯一索引是有意的：同一 `eventId` 出现两次一定是 bug（重试写新行、而不是
     * update 已有的行），而让这个 bug 变成一次插入失败比让它悄悄产生两条投递记录要好。
     * 分段投递因此把序号拼进 `eventId`（§6.5）。
     */
    eventId: text("event_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),

    watermark: timestamp("watermark", { withTimezone: true }).notNull(),

    attempt: integer("attempt").notNull().default(1),
    status: text("status")
      .$type<"pending" | "delivered" | "failed">()
      .notNull()
      .default("pending"),
    httpStatus: integer("http_status"),
    error: text("error"),

    /** 退避重排的时间（§6.4：`1s → 5s → 30s → 5min → 30min`，最多 8 次）。 */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_event_idx").on(table.eventId),
    // 待重试队列。只覆盖 pending 行，所以已投递的那批不会拖慢这条扫描。
    index("webhook_deliveries_retry_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    // 「最近 20 条投递记录」（§6.8）。
    index("webhook_deliveries_sub_idx").on(table.subscriptionId),
  ]
)

export const subscriptionsRelations = relations(subscriptions, ({ many, one }) => ({
  apiKey: one(apiKeys, {
    fields: [subscriptions.apiKeyId],
    references: [apiKeys.id],
    relationName: "subscriptionApiKey",
  }),
  owner: one(user, {
    fields: [subscriptions.userId],
    references: [user.id],
    relationName: "subscriptionUser",
  }),
  deliveries: many(webhookDeliveries),
}))

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    subscription: one(subscriptions, {
      fields: [webhookDeliveries.subscriptionId],
      references: [subscriptions.id],
    }),
  })
)

export type SubscriptionRow = typeof subscriptions.$inferSelect
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect
