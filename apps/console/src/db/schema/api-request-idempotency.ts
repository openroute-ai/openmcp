/**
 * `Idempotency-Key` 的回放记录（设计文档 §3.3）。
 *
 * 这张表回答的是"这个客户端**是不是已经**为这组参数调过这个端点"。它不是一个缓存，
 * 也不是审计：审计（`api-request-audit.ts`）记"发生过什么"，这张表记"下次该回什么"。
 *
 * 不带这头的请求天然幂等 —— `upsertRepo` 按 `(owner, name)` 冲突更新，重复提交同一个
 * URL 只是刷新，`created` 从 `true` 变 `false`。带了这头才多出两件事：
 *
 * 1. **同 key + 同参数 → 原样回放上一次的状态码与响应体。** 网络层丢掉了一个 201 而
 *    客户端不确定是否成功时，这是唯一能避免"重复登记 + 回调两次"的办法。
 * 2. **同 key + 不同参数 → 409。** 少了这条，一个重试生成器（每个 key 复用一次，
 *    body 循环）会静默地提交出一串不同的仓库，而没有任何一处会说"你的 key 撞了"。
 *
 * **主键是 `(key_hash, idempotency_key)`**，不是单列：key 是**每把凭据**一个作用域的。
 * 两把 key 用同一个 `Idempotency-Key` 是两个毫不相干的客户端，它们各自的"第一次"
 * 都必须是第一次；共用一个命名空间会让 A 的重试被 B 的请求判成 409，而它们根本
 * 看不见对方。
 */
import { relations } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { apiKeys } from "./api-keys"

/** 设计文档给的重放窗口：24 小时。 */
export const IDEMPOTENCY_TTL_HOURS = 24

export const apiRequestIdempotency = pgTable(
  "api_request_idempotency",
  {
    /**
     * 调用方的 `sha256(明文)`，**不是** `api_keys.id`。
     *
     * 用 id 也够用（它同样能区分两把 key），但 hash 让这张表在"只有 hash"的排障视图里
     * 也能与 `api_keys` 对上：给定一个泄漏的 hash，可以直接问"这把 key 有没有重放过
     * 什么"，而不必先知道它对应哪个 id。
     */
    keyHash: text("key_hash").notNull(),

    /** 客户端生成的那一串。原文入库：它不是机密（它自己选的），而 hash 后就没法排障了。 */
    idempotencyKey: text("idempotency_key").notNull(),

    /**
     * 这组请求参数的指纹，回答"是不是同一个请求"。
     *
     * 存 hash 而不是原始 body：body 里可能有 `callbackSecret`（明文），存进去就是
     * 把回调密钥抄一份到一张 24 小时后才清理的表里。
     */
    requestFingerprint: text("request_fingerprint").notNull(),

    /** 回放时原样送回的状态码。 */
    responseStatus: integer("response_status").notNull(),

    /**
     * 回放时送回的响应体。存的是**值**而不是字节流：`jsonb` 会重排键序，所以回放与首次
     * 响应语义一致但不逐字节相同。客户端必须按 JSON 解析，而不是比对原始字节。
     */
    responseBody: jsonb("response_body").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.keyHash, table.idempotencyKey] }),
    /**
     * 清理任务的扫描路径。
     *
     * `created_at` 单列索引：过期清理是"扫出 24 小时前的行然后删"，不带 `key_hash`
     * 前缀，所以不能复用主键。留着这行是必要的 —— 没有它，一周之后第一次清理就是一个
     * 全表扫描，而这张表的大小由客户端的重试频率决定，不受任何配额约束。
     */
    index("api_request_idempotency_created_at_idx").on(table.createdAt),
  ]
)

export const apiRequestIdempotencyRelations = relations(
  apiRequestIdempotency,
  ({ one }) => ({
    // 不加外键：`api_keys` 会在轮换与吊销时留存，删 key 的动作（admin 清理）
    // 不应该连带删掉"这个客户端当时回放过什么"的痕迹。同 `api_request_audit` 的取舍。
    key: one(apiKeys, {
      fields: [apiRequestIdempotency.keyHash],
      references: [apiKeys.keyHash],
      relationName: "apiRequestIdempotencyKey",
    }),
  })
)

export type ApiRequestIdempotencyRow =
  typeof apiRequestIdempotency.$inferSelect