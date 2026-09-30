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
 * 扩展的 user 表：在共享 auth schema 基础上增加手机号登录所需的
 * phoneNumber / phoneNumberVerified。仅 console 使用（local `user` 遮蔽
 * `export *` 重新导出的共享 user 表），避免污染 web/api 的共享 schema。
 *
 * `role` 与共享 schema 同名同义（"admin" | "user"），Better Auth 通过
 * `user.additionalFields` 把它带进 session，因此这里的默认值必须与共享
 * schema 一致；缺少该列会让 better-auth 的 schema 校验直接失败。
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
   * 与共享 schema 逐字一致（可空 + 默认值），因此本表始终是共享 user 表的
   * 真子集：console 多出的只有手机号两列，不会出现"同名同列不同类型"的
   * 分叉。是否管理员一律按 `role === "admin"` 判断，null 视为普通用户。
   */
  role: varchar("role", { length: 256 }).default("user"),
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
