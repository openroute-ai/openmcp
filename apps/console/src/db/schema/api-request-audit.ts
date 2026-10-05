import { relations } from "drizzle-orm"
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { user } from "../schema"

/**
 * 谁改过 API key 的权限。
 *
 * admin-only 的年代这不紧急 —— 谁签的 key 心里有数。**自助签发打开之后它才成为
 * 前提**："这个账号签了多少把 key"、"admin 改过谁的权限" 从此是必须能回答的问题，
 * 而 `api_keys` 本身答不了：它记录的是一把 key 的**当前**状态，而 `updateScopes`
 * 是就地覆盖，`scopes` 里看不出昨天是什么。
 *
 * 更要紧的是 §2.1 列的三条理由里第一条 —— "泄漏后无法定位来源"。凭据泄漏时唯一
 * 真正需要的信息是"过去 30 天这把 key 调过哪些仓库"，而 `last_used_at` 只回答
 * "是否在用"。
 */
export const apiRequestAudit = pgTable(
  "api_request_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /**
     * 纯文本，**不加外键**。
     *
     * 这是 `api_keys.user_id` 用 `ON DELETE CASCADE` 的对价：key 随账号一起没了，
     * 但"当时是谁在调用"必须留下。写成带外键的 text 会在删账号时静默把审计线索
     * 一起抹掉，那正好抹掉了这张表存在的理由。
     */
    userId: text("user_id"),

    /** 同样不带外键，理由同上 —— 而且 key 会被轮换删除。 */
    apiKeyId: text("api_key_id"),

    /** 明文的前 4 字符。key 被删之后仍然能认出"是哪一把"。 */
    keyPrefix: text("key_prefix"),

    /**
     * 变更类型。见 `ApiAuditAction`。
     *
     * 刻意不给它建 enum 列：`text` 让新动作不需要迁移，而这张表的用途是"记下
     * 发生过什么"，不是"约束现在允许什么"。真正的约束在调用方的字面量上。
     */
    action: text("action").notNull(),

    /** 变更前。`null` 表示这是新建，没有"之前"。 */
    before: jsonb("before"),

    /** 变更后。 */
    after: jsonb("after"),

    /** 为什么。吊销与改权限时管理员给的理由。 */
    reason: text("reason"),

    /** 调用方 IP。自助入口拿得到，因为 tRPC context 带了 `headers`。 */
    ip: text("ip"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // admin 治理页的默认查询："这个 owner 的 key 发生过什么"，最新在前。
    index("api_request_audit_user_id_created_at_idx").on(
      table.userId,
      table.createdAt.desc()
    ),
    // 凭据泄漏排查的查询形状："这把 key 做过什么"。
    index("api_request_audit_api_key_id_idx").on(table.apiKeyId),
  ]
)

export const apiRequestAuditRelations = relations(
  apiRequestAudit,
  ({ one }) => ({
    /**
     * 只连 `owner`，不连 key。
     *
     * 这一列是"这把 key 当时的归属人"，而不是"这把 key" —— 后者会 tempt 一个
     * `ON DELETE` 行为，而删除 key 是轮换的正常结果，不应该删掉它的审计。
     */
    owner: one(user, {
      fields: [apiRequestAudit.userId],
      references: [user.id],
      relationName: "apiRequestAuditOwner",
    }),
  })
)

/**
 * 写入 {@link apiRequestAudit} 的动作字面量。
 *
 * 单独导出成一个联合类型而不是直接用 `string`，是为了让"忘了加新动作到类型里"
 * 变成一次编译错误 —— 而漏掉一次写入的代价是"这次改动永久查不到是谁做的"。
 */
export const API_AUDIT_ACTIONS = [
  "key.create",
  "key.revoke",
  "key.rotate",
  "key.surrender",
  "scopes.update",
  "limits.update",
  /**
   * 接入方兑换掉了配对码（§2.11）。
   *
   * 列在这里而不是在 `connection_pairings` 上，是因为它回答的是审计的那个问题：
   * "这把 key 是怎么来的"。配对记录会过期清理，而审计不会——凭据泄漏往往在泄漏很久
   * 之后才被发现，那时配对行早就没了。
   */
  "connection.redeem",
  /**
   * 管理员停用了一条别人的订阅（§6.7）。
   *
   * 列在这里而不是只记在 `subscriptions.disabled_reason` 上，是因为那一列只说"被关了"，
   * 不说"谁关的、为什么"。停用会立刻改变别人能收到什么数据，所以问"这条订阅为什么停
   * 着"的答案必须包含操作者。
   */
  "subscription.disable",
] as const

export type ApiAuditAction = (typeof API_AUDIT_ACTIONS)[number]

/**
 * 永远不能进 `before` / `after` 的字段名。
 *
 * 见 `lib/api/audit.ts` 的实现：这张表的意义就是"能查清谁在什么时候改了什么"，
 * 而它最容易被破坏的方式就是把机密一起写进去。`key_hash` 尤其危险：它不是明文，
 * 所以任何"顺手把整行 select 出来记进去"的写法都不会被肉眼看出来。
 */
export const API_AUDIT_FORBIDDEN_FIELDS = [
  "secret",
  "keyHash",
  "key_hash",
] as const
