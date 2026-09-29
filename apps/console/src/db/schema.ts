import * as authSchema from "@workspace/db/schema"
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import * as githubSchema from "./schema/github"

export * from "@workspace/db/schema"
export * from "./schema/github"

/**
 * 扩展的 user 表：在共享 auth schema 基础上增加手机号登录所需的
 * phoneNumber / phoneNumberVerified。仅 console 使用（local `user` 遮蔽
 * `export *` 重新导出的共享 user 表），避免污染 web/api 的共享 schema。
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
