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
import type { ApiTier } from "@/lib/api/scopes"

/**
 * 开放 API 的调用凭据。
 *
 * 签发入口是 console 自己的 tRPC，**不是** `/api/v1` —— 否则任何人都能给自己发
 * 一把 key。两个入口按角色分开：用户自助走 `apiKeys.createMine`，管理员走
 * `apiKeys.create`。设计见 `docs/design/CONSOLE_OPEN_RADAR_API.md` §2。
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

    /**
     * 【新增】**归属人**：这把 key 是谁的，"我的 API Key" 列表按它过滤。
     *
     * 现有两列都不够，所以这一列是自助签发的唯一 schema 阻塞点：
     *
     * | 列 | 回答的问题 | 为什么不能当归属 |
     * |---|---|---|
     * | {@link apiKeys.createdBy} | 「谁**签发**了它」 | admin 给别人签发时，签发者是 admin、主人是别人。自助签发一旦打开，两者恒等，这个歧义才会暴露 |
     * | {@link apiKeys.submitterId} | 「提交仓库时 `user_repos` 记谁」 | 完全另一个问题。一把 key 可以不归属任何账号，也可以与主人不同 |
     *
     * `CASCADE` 而不是 `SET NULL`：账号没了，"我的 key" 就不该留下一把无人能吊销
     * 的钥匙。代价是审计线索随账号一起消失，因此 `api_request_audit` 的
     * `user_id` 刻意是不带级联的纯文本列。
     *
     * `NULL` = 没有人类主人的接入方 key（admin 签发的 service tier）。
     */
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),

    /**
     * 配额档位。**不是权限** —— 权限只看 {@link apiKeys.scopes}。
     *
     * 把配额档位和权限分成两个字段，是为了不让"升级 tier 就能越权"成为一个成立的
     * 猜想。所以 `tier` 只做两件事：决定 §2.8 的默认配额，以及决定自助签发时允许
     * 勾选的范围。
     *
     * `user` = 有主人，`service` = 无主人。**有主人 ⇒ user tier，无主人 ⇒ service
     * tier**，服务层强制（`assertTierMatchesOwner`），`0022` 里还有一条 CHECK 兜底。
     * 一旦允许"服务 key 也有主人"，管理员端就会同时出现按 owner 查和按 tier 查两套
     * 互相重叠的过滤维度，而两者的交集语义说不清。
     *
     * `$type<ApiTier>` 把数据库里的 `text` 收窄成两个字面量。
     *
     * `$type` 而不是 `text(..., { enum: API_TIERS })`：后者会让 drizzle 在
     * `scopeEnum` 上生成一条 `pg_enum` CREATE TYPE，而 enum 加值要先改类型而不是
     * 加行 —— 那是一次迁移加一次类型重建，比 `text` + 应用层收窄贵得多，而收益
     * 只有"数据库自己也拒绝坏值"。这个代价由 `0022` 里那条 CHECK 付掉：它钉住
     * 真正要紧的不变量（tier 与 user_id 一致），而不是"tier 是这两个词之一"。
     *
     * **默认 `'service'`，不是 `'user'`。** 一个没传 tier 的裸 `INSERT` 一定是一把
     * 无主的接入方 key，所以 `'service'` 才是那个输入的正确值；而 `'user'` 会留下
     * 一行 `user_id IS NULL` 的 user tier —— 一把"自助范围内、却没有任何人能吊销
     * 它"的 key。存量回填也一样：现有每一行都是 admin 签发的无主 key，全是
     * service。这一列的 default 就是那条 `ALTER TABLE ... ADD COLUMN` 的回填值，
     * 所以它的取值决定了迁移语义，不只是一个插入兜底。
     */
    tier: text("tier").$type<ApiTier>().notNull().default("service"),

    /** 谁签发了这把 key。console 自己的 user 表，不对外暴露。 */
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

    /**
     * 【新增】最后一次轮换的时间。与 `created_at` 的差就是"这把 key 用了多久没换"。
     *
     * 只服务自助页面那一句"用了两年了，换一把吧"的提示，**不参与鉴权**。自助
     * 轮换会写它，admin 轮换不写 —— 两者动机不同：admin 轮换是运维动作（例行
     * 换密），自助轮换是用户看到提示之后点的。
     */
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),

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
    // 自助签发的每一条查询都走这一条，所以它和 created_by 同级重要。
    index("api_keys_user_id_idx").on(table.userId),
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
 * 写入，出现在响应里会是几分钟前的 —— 列表页要显示它时单独 select。
 */
export const API_KEY_PUBLIC_COLUMNS = [
  "id",
  "prefix",
  "name",
  "userId",
  "tier",
  "createdBy",
  "submitterId",
  "scopes",
  "rateLimitRpm",
  "rateLimitRpd",
  "lastRotatedAt",
  "expiresAt",
  "revokedAt",
  "revokedReason",
  "createdAt",
] as const satisfies readonly (keyof typeof apiKeys.$inferSelect)[]

export const apiKeyRelations = relations(apiKeys, ({ one }) => ({
  /**
   * 主人。`fields`/`references` 必须显式写出来，因为一个外键指向 `user.id` 的
   * 关系在这个文件里不止一个（下面两个也是），drizzle 无法从类型反推是哪一对。
   */
  owner: one(user, {
    fields: [apiKeys.userId],
    references: [user.id],
    relationName: "apiKeysOwner",
  }),
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
