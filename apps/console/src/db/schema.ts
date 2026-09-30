import { relations } from "drizzle-orm"
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core"
import * as githubSchema from "./schema/github"

export * from "./schema/github"

/**
 * `repos` and `snapshots` exist in both the shared schema and console's own
 * GitHub tables, and `export *` cannot decide between them: TypeScript reports
 * TS2308 and drops the name entirely, so every console caller silently
 * resolves to the *shared* table instead. That table has `contributorsCount`
 * where console's data has `contributorCount`, and a per-day `month` column
 * where console stores an aggregated `months` array, which is where the schema
 * type errors in the GitHub services came from.
 *
 * An explicit re-export resolves the ambiguity in favour of console's tables,
 * which are the ones the `drizzle-kit` migrations under `src/db/drizzle` were
 * generated from and the only ones the console queries.
 */
export { repos, snapshots } from "./schema/github"

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

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
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

export type User = typeof user.$inferSelect

/**
 * Better Auth 和 `drizzle-kit` 看到的全部内容：console 自己的四张 auth 表加上
 * GitHub schema。`src/lib/auth.ts` 把它作为 Better Auth 的 `schema` 传入，而
 * Better Auth 只读这四张——它此前拿到的是共享 schema 的全部 86 张表。
 */
export const schema = {
  user,
  session,
  account,
  verification,
  ...githubSchema,
}
