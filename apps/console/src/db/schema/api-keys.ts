import { relations } from "drizzle-orm"
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { user } from "../schema"

/**
 * 开放 API 的调用凭据。签发入口是 console 自己的 tRPC（`adminProcedure`），
 * 不是 `/api/v1` —— 否则任何人都能给自己发一把 key。设计见
 * `docs/design/CONSOLE_OPEN_RADAR_API.md` §2。
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),

    /**
     * `sha256(明文)`，唯一索引。
     *
     * sha256 而不是 bcrypt / argon2：key 是 256 bit 的随机串，不是人选的口令，
     * 没有需要抗的字典。这里防的是数据库泄漏后直接拿到明文，而慢哈希会让**每
     * 一次** API 调用都付出一段百毫秒级延迟。同样的取舍见
     * `docs/design/API_KEY_LITELLM_PROXY.md`。
     */
    keyHash: text("key_hash").notNull(),

    /**
     * 明文的前 4 个字符，给 UI 展示和人工比对用。
     *
     * 不足以鉴权：只有 24 bit，而且是随机串的前缀，不携带任何结构。
     */
    prefix: text("prefix").notNull(),

    /** 人读的名字，唯一性不由数据库保证。 */
    name: text("name").notNull(),

    /** 谁签发了这把 key。`SET NULL` 以免删账号时连带删掉审计线索。 */
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),

    /**
     * 这把 key 通过 `POST /api/v1/repos` 提交仓库时，`user_repos` 记谁。
     *
     * 与 {@link apiKeys.createdBy} 分开，因为两者回答不同的问题：前者是"这次提
     * 交算谁的"，后者是"谁发的这把钥匙"。同一把 key 长期可以为多个提交者代
     * 交，所以不能合成一列。
     *
     * 用它而不是 `repos.created_by`，是为了 API 提交不改动仓库原有的归属。
     */
    submitterId: text("submitter_id").references(() => user.id, {
      onDelete: "set null",
    }),

    /** 见 `API_SCOPES`。加法权限：`repos:read` 不含 `repos:write`。 */
    scopes: text("scopes").array().notNull(),

    /** 每分钟请求数上限。 */
    rateLimitRpm: integer("rate_limit_rpm").notNull().default(60),

    /** 每日请求数上限。跨 UTC 日界，与 GitHub 的额度口径一致。 */
    rateLimitRpd: integer("rate_limit_rpd").notNull().default(5000),

    /** 到期时间。`NULL` 表示不过期。 */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /** 置位即失效，没有缓存需要清。 */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /** 为什么吊销。给持有者一个能问出口的理由。 */
    revokedReason: text("revoked_reason"),

    /**
     * 最后一次通过鉴权的请求。
     *
     * 每次请求都写会增加一次 UPDATE，所以调用方异步写、失败只记日志；这一列
     * 是"这把 key 还在用吗"的答案，不参与鉴权，因此可以偶尔丢一次。
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    // 鉴权按 hash 查，这一条就是鉴权路径上的全部索引工作。
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_created_by_idx").on(table.createdBy),
    // 列在这张表上找 key（吊销、轮换、列全部活跃 key）。`/dashboard` 的默认
    // 视图就是"未吊销的 key"。
    index("api_keys_active_idx").on(table.revokedAt, table.expiresAt),
  ]
)

/**
 * 一行 `api_keys` 里可以出现在读接口里的列。
 *
 * `keyHash` 与 {@link apiKeys.prefix} 之外的任何东西都不足以重建明文，但
 * `keyHash` 仍然不导出：它没有读接口要用的场合，留在类型里只会让"顺手 select
 * 出来打日志"变成一次可能的泄漏。`lastUsedAt` 也不导出，因为它的值来自异步
 * 写入，出现在响应里会是几分钟前的。
 */
export const API_KEY_PUBLIC_COLUMNS = [
  "id",
  "prefix",
  "name",
  "createdBy",
  "submitterId",
  "scopes",
  "rateLimitRpm",
  "rateLimitRpd",
  "expiresAt",
  "revokedAt",
  "revokedReason",
  "createdAt",
] as const satisfies readonly (keyof typeof apiKeys.$inferSelect)[]

export const apiKeyRelations = relations(apiKeys, ({ one }) => ({
  createdByUser: one(user, {
    fields: [apiKeys.createdBy],
    references: [user.id],
    relationName: "apiKeysCreatedBy",
  }),
  submitter: one(user, {
    fields: [apiKeys.submitterId],
    references: [user.id],
    relationName: "apiKeysSubmitter",
  }),
}))