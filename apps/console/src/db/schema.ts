import * as authSchema from "@workspace/db/schema"
import {
  boolean,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core"
import * as githubSchema from "./schema/github"

export * from "@workspace/db/schema"
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

export const schema = {
  ...authSchema,
  ...githubSchema,
  user,
}
