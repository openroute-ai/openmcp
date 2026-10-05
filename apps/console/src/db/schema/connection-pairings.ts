/**
 * 接入方配对码（设计文档 §2.11）。
 *
 * `POST /api/v1/connections/redeem` 是**唯一一个不需要凭据**的 `/api/v1` 端点 —— 它的
 * 安全边界等于 OAuth device flow。凭据正是它要发的东西，所以发起方向只能是 console
 * 侧：用户登录 `/console/connections` 拿到配对码，回接入方兑换。
 *
 * 一行是"一次兑换凭证"，读完即废（`redeemed_at`），5 分钟过期。这两件事都由数据库
 * 承担而不是靠进程内状态：多副本部署下"单次有效"如果只在某个副本的内存里成立，同一个
 * 码就能兑换两次。
 *
 * **key 在兑换那一刻才签发**，而不是建码时就签好等着。这一条是对 §2.11 表格里
 * "`(keyId, …)`"那个说法的收紧，理由是明文的去向：key 必须在建码时签发就意味着明文
 * 要么存在数据库里等着被读出来（于是这把 key 在兑换之前就已经"可用"了，而它落在库里
 * 的时间没有上界），要么被加密存起来（为一个 5 分钟窗口引入一套密钥管理）。兑换时
 * 签发则让明文只出现在一个地方 —— 兑换响应 —— 也让 `user_id` 在签发时就有值。
 */
import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { user } from "../schema"
import { apiKeys } from "./api-keys"
import type { ApiScope } from "@/lib/api/scopes"

/** 配对码的字符集：去掉了 `0` `O` `1` `I`，剩下的字符两两之间都能一眼分开。 */
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export const PAIRING_CODE_LENGTH = 8

/** 设计文档给的 TTL：5 分钟。 */
export const PAIRING_CODE_TTL_SECONDS = 300

/** 单 IP 每小时最多兑换几次。 */
export const PAIRING_RATE_LIMIT_PER_HOUR = 20

export const connectionPairings = pgTable(
  "connection_pairings",
  {
    id: text("id").primaryKey(),

    /**
     * 配对码。
     *
     * 唯一索引而不是"查出来再比"：前者让并发兑换只有一个能成功，后者在两个请求同时
     * 到达时都会读到 `redeemed_at IS NULL`，然后都以为自己赢了。
     *
     * 8 个字符 ≈ 40 bit 熵（32 个字符的 8 次方），足够抗"按小时试"而不够抗离线穷举
     * 全部空间 —— 所以 TTL 与每小时 20 次的限流是这条设计里真正起作用的两件事。
     */
    code: text("code").notNull(),

    /**
     * 兑换时签发的 key，**建码时为 `NULL`**。
     *
     * 兑换与写入在同一个事务里，所以"建码"与"已兑换"之间不存在一个已签发但没人
     * 拿得到的 key：那把 key 从产生到离开这个进程只有一个瞬间。
     */
    apiKeyId: text("api_key_id").references(() => apiKeys.id, {
      onDelete: "cascade",
    }),

    /** 谁登录 console 建的这一行。签发出来的 key 归他。 */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * 兑换时必须**精确相等**的回调地址。
     *
     * 前缀匹配会让 `https://evil.com/?x=https://mcp.openmcp.host` 通过校验 —— 这是
     * 最典型的开放重定向，而配对码正是让外部站点拿到 API key 的那条路。
     */
    returnUrl: text("return_url").notNull(),

    /** 建码时选定的 scope，兑换时就按这一组签发。 */
    scopes: text("scopes").array().$type<ApiScope[]>().notNull(),

    /**
     * 给这把 key 起的名字。兑换响应里回显，接入方据此知道这把 key 是干什么的
     * ——它不会看到 console 侧的 key 列表，所以这个名字就是它唯一的上下文。
     */
    name: text("name").notNull(),

    /**
     * 建码的人在哪台机器上。
     *
     * 限流卡的是**兑换**那一侧（`redeemed_ip`），但这个也留着：泄漏排查要回答
     * "这把码是在哪台机器上被人看到的"，而码在有效期内是可以被截图的。
     */
    createdIp: text("created_ip"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** 置位即已用过。兑换在同一个事务里写它，所以它同时是"单次有效"的实现。 */
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedIp: text("redeemed_ip"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("connection_pairings_code_idx").on(table.code),
    // 「我建了哪些码 / 还没用掉的那些」——页面与清理任务都是这个形状。
    index("connection_pairings_user_idx").on(table.userId, table.createdAt.desc()),
    // 过期清理：按到期时间扫，不扫 `created_at`，因为 TTL 是相对 `expires_at` 的。
    index("connection_pairings_expires_at_idx").on(table.expiresAt),
  ]
)

export const connectionPairingsRelations = relations(
  connectionPairings,
  ({ one }) => ({
    apiKey: one(apiKeys, {
      fields: [connectionPairings.apiKeyId],
      references: [apiKeys.id],
      relationName: "connectionPairingKey",
    }),
    owner: one(user, {
      fields: [connectionPairings.userId],
      references: [user.id],
      relationName: "connectionPairingUser",
    }),
  })
)

export type ConnectionPairingRow = typeof connectionPairings.$inferSelect