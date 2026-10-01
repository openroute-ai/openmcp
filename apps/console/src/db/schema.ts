import { relations } from "drizzle-orm"
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core"
import * as githubSchema from "./schema/github"
import { repos } from "./schema/github"
import { apiKeys } from "./schema/api-keys"

export * from "./schema/github"
export * from "./schema/api-keys"

/**
 * `repos` and the `*Stats` tables exist in both the shared schema and console's
 * own GitHub tables, and `export *` cannot decide between them: TypeScript
 * reports TS2308 and drops the name entirely, so every console caller silently
 * resolves to the *shared* table instead. That table has `contributorsCount`
 * where console's data has `contributorCount`, which is where the schema type
 * errors in the GitHub services came from.
 *
 * An explicit re-export resolves the ambiguity in favour of console's tables,
 * which are the ones the `drizzle-kit` migrations under `src/db/drizzle` were
 * generated from and the only ones the console queries.
 *
 * `repoStargazers` is named only here because the shared schema exports nothing
 * that collides with it today; it is listed so the set stays in one place if
 * that changes.
 */
export {
  repos,
  repoDailyStats,
  repoMonthlyStats,
  repoWeeklyStats,
  repoStargazers,
} from "./schema/github"

/**
 * console 的 user 表：与共享 auth schema 逐字相同。
 *
 * console 有自己的数据库（`CONSOLE_DATABASE_URL`，与 web/api 的
 * `DATABASE_URL` 分开），也不依赖 `@workspace/auth`，所以这份定义是 console
 * 自己拥有的、不是共享 schema 的视图——它此前是共享表的一个**子集**（省略了
 * `banned` / `banReason` / `banExpires` / `customerId`），靠注释维持一致。
 * 现已补齐，Better Auth 的 admin plugin 需要的封禁列也不再缺失。
 *
 * `role` 与手机号两列的行为见下方注释；`role` 由 Better Auth 通过
 * `user.additionalFields` 带进 session，缺列会让 schema 校验直接失败。
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified")
    .default(false)
    .notNull(),
  /**
   * 平台角色。`/dashboard` 只对 admin 开放，其余登录用户落在 `/console`，
   * 只能查看仓库列表并添加仓库。见 `src/lib/auth/role.ts`。
   *
   * 是否管理员一律按 `role === "admin"` 判断，null 视为普通用户。
   */
  role: varchar("role", { length: 256 }).default("user"),
  /**
   * 封禁三列 + `customer_id`：Better Auth 内置的 admin plugin 会读写它们，
   * `ban()` / `unbanUser()` 直接落到这几列上。省略它们不是"更小的表"，而是
   * 少了几列——plugin 仍在运行，写入会因列不存在而失败。
   */
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  customerId: text("customer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

/**
 * `session` / `account` / `verification`: Better Auth 的三张表，由 console 自己
 * 拥有——理由与上面的 `user` 相同。
 *
 * `session` 上还带着 `active_organization_id` / `impersonated_by` 两列。它们是
 * better-auth **organization 插件**的产物，而 console 的 `src/lib/auth.ts` 只装了
 * `phoneNumber` 与 `openAPI`，从未装 organization——**所以这两列没有任何代码读取，
 * 下面那行注释之外不要指望它们有意义。**
 *
 * 它们仍然被声明，是因为生产库里这两列已经存在。schema 不声明、库里有，是
 * schema 与数据库不一致的唯一一种形态，而 `drizzle-kit push` 对这种差异的处理
 * 是**删列**：`push` 每次都会弹出
 *「You're about to delete active_organization_id column in session table」。
 * 一次顺手确认的 push 就是一次不可逆的数据丢失，而留着两列的成本是两条没人读的
 * 定义。两者不对等，所以选后者。
 *
 * 代价是 `generate` 会为它们发一次 `ADD COLUMN`（没有任何 migration 建过它们）。
 * 那条迁移必须写成 `ADD COLUMN IF NOT EXISTS`：生产库已有这两列，裸 `ADD COLUMN`
 * 会直接报错。见 `0010_preserve_legacy_columns.sql`。
 *
 * 与共享表保持一致的义务仍然存在（列名/类型逐字对齐），只是不再由 import 自动
 * 继承。`account` 与 `verification` 当前本就一致，照抄是为了让它们不再成为下一次
 * 漂移的入口。
 */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 未使用。仅为保住生产库里已有的列，见上方注释。 */
    activeOrganizationId: text("active_organization_id"),
    /** 未使用。仅为保住生产库里已有的列，见上方注释。 */
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

/**
 * 用户对某个仓库的处置：这一对关系里**只有这个用户**看得见的部分。
 *
 * 与上面的公共列相反——`note` / `pinned` / `lastViewedAt` 从不跨用户读取。
 * 读别处的行是可能的（管理员看得到，见 `UserRepoVisibility`），但每个非管理员
 * 的查询都被限定在自己的 `user_id` 上，所以"互相看不到各自的更新"是查询形状
 * 强制的，而不是靠界面不显示。
 *
 * 三个取值对应一个用户对一份自己提交的仓库能有的三种态度。`ignored` 不是
 * 删除：删除会让"谁提交过它"这条公共记录消失，而那恰恰是所有人都该看到的；
 * `ignored` 只是把它从自己的列表里收起来。
 */
export const USER_REPO_STATUSES = ["active", "ignored", "archived"] as const

export type UserRepoStatus = (typeof USER_REPO_STATUSES)[number]

/**
 * 平台对某个仓库已经做了什么——**所有人**都能看到的那一半。
 *
 * 三个状态按优先级从高到低判定，一个仓库同时满足两个时取靠前的那个，所以这是
 * "最远走到了哪一步"，而不是三个互斥的开关。
 *
 * 这一列是 `repos` 与 `projects` 的**物化**结果，不是它们之外的第二个事实来源。
 * 写入它的地方只有 {@link recomputePlatformStates}，而那个函数直接在这两张表
 * 上算出来，所以这一列不可能比它们更"新"。相应地它的代价是：任何改变仓库平台
 * 状态的动作都必须调它，否则显示会停在旧值上。它被单独抽成一个函数而不是散落
 * 在各处，正是为了这个——要漏就漏在一个能搜到的名字上。
 *
 * 只有三个而不是四个，是刻意的：`pending`（"刚提交、平台还没看过"）和 `tracked`
 * 的区别只是 `repos.updated_at` 是否已填，而提交的那一刻 upsert 就把它填上了，
 * 于是 `pending` 在真实数据里不可达。一个永远读不到的状态不是状态，只是一个让
 * 界面多写一个分支的字符串。"刚提交"与"跟踪了很久"的差别由
 * {@link userRepos.platformSyncedAt} 这个时间戳回答，而不是由一个词。
 */
export const PLATFORM_REPO_STATUSES = ["tracked", "curated", "archived"] as const

export type PlatformRepoStatus = (typeof PLATFORM_REPO_STATUSES)[number]

/**
 * 用户提交的仓库，以及这一对关系上双方各自的状态。
 *
 * **为什么需要这张表。** `repos.created_by` 只能记一个人：第一个提交者。第二
 * 个用户提交同一个 URL 时，那一列**不能**被改写（否则谁先来就决定了别人还能
 * 不能在 `/console` 看到它），于是这个用户和这个仓库之间的关联无处可放。
 *
 * 这一对关系同时住在两个世界里，而这张表把两边分得很干净：
 *
 * **公共的**——`source`、`submittedAt` 是**这个用户**针对这个仓库的公共操作：
 * "某某在某天通过 console 提交了它"。还有 `platformStatus` /
 * `platformSyncedAt`，那是平台针对**这个仓库**的公共操作。同一个仓库的每一
 * 行都带着同一份平台状态，所以把它物化在行上不会让不同用户看到不一致的内容。
 *
 * **私有的**——`status` / `note` / `pinned` / `lastViewedAt` 是这个用户自己对
 * 这份提交的处置。`updatedAt` 只跟私有列一起动（见该列注释），所以它读作
 * "他上次改自己的记录是什么时候"，而不是"这一行最后被谁碰过"。
 *
 * `repos` 与 `user` 之间不可能建外键：这张表和 `user` 都在本文件里，而
 * `repos` 由 `./schema/github` 提供，本文件导入它——反向引用会形成循环导入。
 * 与 `repos.created_by` 同理。
 */
export const userRepos = pgTable(
  "user_repos",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),

    /** 公共。这一对关系是怎么产生的。 */
    source: text("source", { enum: ["console", "api", "admin"] })
      .notNull()
      .default("console"),

    /**
     * 私有。这个用户自己对这份提交的处置，见上方 {@link USER_REPO_STATUSES}。
     */
    status: text("status", { enum: USER_REPO_STATUSES })
      .notNull()
      .default("active"),

    /** 私有。只有这一行的主人读它。 */
    note: text("note"),

    /** 私有。把一份提交固定在自己列表的顶部。 */
    pinned: boolean("pinned").notNull().default(false),

    /** 私有。这个用户最近一次打开这份提交的详情页。 */
    lastViewedAt: timestamp("last_viewed_at"),

    /** 公共。用户第一次提交的时间，也就是 `added_at` 那一列的原义。 */
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),

    /** 公共。平台针对这个仓库的进度，见 {@link PLATFORM_REPO_STATUSES}。 */
    platformStatus: text("platform_status", { enum: PLATFORM_REPO_STATUSES })
      .notNull()
      .default("tracked"),

    /**
     * 公共。平台最后一次刷新这个仓库的 GitHub 数据的时间。
     *
     * 与 {@link userRepos.platformStatus} 分开，是因为"平台做了什么"和"平台做
     * 到什么程度"是两个问题：一个跟踪了两年的仓库和一个刚提交的仓库平台状态同
     * 为 `tracked`，差别只在这个时间戳上。
     */
    platformSyncedAt: timestamp("platform_synced_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * 私有列最后被**这个用户**改动的时间。
     *
     * 平台状态写在 `platformSyncedAt` 上，不碰这里，所以这一列不会被平台的
     * 定时刷新顶起来——否则它会回答"平台多久没干活了"，而名字说的是用户自己
     * 的记录。想看后者请读 `platformSyncedAt`。
     */
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.repoId] }),
    index("user_repos_user_id_idx").on(table.userId),
    index("user_repos_repo_id_idx").on(table.repoId),
    // `/console` 的默认列表就是"我提交的、按时间倒序"，这个复合索引直接服务它，
    // 不必再按 user_id 过滤一遍全表。
    index("user_repos_user_submitted_idx").on(table.userId, table.submittedAt),
  ]
)

/**
 * 一行 `user_repos` 里，谁能看到哪部分。
 *
 * 公共列与私有列的切分就是这个类型，而不是一句约定：让类型跟着列走，写错查询
 * 的形状会由 `select` 的字段名暴露出来，而不是等到某条查询不小心把 `note`
 * 带了回去。
 */
export const USER_REPO_PUBLIC_COLUMNS = [
  "userId",
  "repoId",
  "source",
  "submittedAt",
  "platformStatus",
  "platformSyncedAt",
  "createdAt",
] as const satisfies readonly (keyof typeof userRepos.$inferSelect)[]

/**
 * 一行 `user_repos` 里，只有主人能读的部分。
 *
 * 见 {@link USER_REPO_PUBLIC_COLUMNS}。`updatedAt` 也算私有的：它只在私有列
 * 变动时更新，所以谁也看不出别人的行被平台动过。
 */
export const USER_REPO_PRIVATE_COLUMNS = [
  "status",
  "note",
  "pinned",
  "lastViewedAt",
  "updatedAt",
] as const satisfies readonly (keyof typeof userRepos.$inferSelect)[]

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  repos: many(userRepos),
  // 与 `apiKeyRelations` 的两个 `one` 分别配对；一条用户行既是签发者也可能
  // 是提交者，所以两边都是 many。
  issuedApiKeys: many(apiKeys, { relationName: "apiKeysCreatedBy" }),
  submittedAsApiKeys: many(apiKeys, { relationName: "apiKeysSubmitter" }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const userReposRelations = relations(userRepos, ({ one }) => ({
  user: one(user, {
    fields: [userRepos.userId],
    references: [user.id],
  }),
  repo: one(repos, {
    fields: [userRepos.repoId],
    references: [repos.id],
  }),
}))

export type User = typeof user.$inferSelect

export type UserRepoRow = typeof userRepos.$inferSelect

/**
 * Better Auth 和 `drizzle-kit` 看到的全部内容：console 自己的四张 auth 表加上
 * GitHub schema。`src/lib/auth.ts` 把它作为 Better Auth 的 `schema` 传入，而
 * Better Auth 只读这四张——它此前拿到的是共享 schema 的全部 86 张表。
 *
 * `userRepos` 不在这个对象里：Better Auth 不认识这张表，把它递进去只会让这个
 * 对象与"库里有几张表"脱钩。它由 `drizzle-kit` 通过 `src/db/drizzle-schema.ts`
 * 管理。
 */
export const schema = {
  user,
  session,
  account,
  verification,
  ...githubSchema,
}
