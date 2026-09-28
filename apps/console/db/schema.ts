import * as authSchema from "@workspace/db/schema"
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
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
  phoneNumberVerified: boolean("phone_number_verified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const SECTION_STATUSES = [
  "In Process",
  "Done",
  "Cancled",
  "Rejected",
] as const

export type SectionStatus = (typeof SECTION_STATUSES)[number]

export const sections = pgTable(
  "sections",
  {
    id: serial("id").primaryKey(),
    header: text("header").notNull(),
    type: text("type").notNull(),
    status: text("status")
      .$type<SectionStatus>()
      .notNull()
      .default("In Process"),
    target: integer("target").notNull(),
    limit: integer("limit").notNull(),
    reviewer: text("reviewer").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("sections_status_idx").on(table.status),
    index("sections_reviewer_idx").on(table.reviewer),
    index("sections_position_idx").on(table.position),
  ]
)

export const traffic = pgTable(
  "traffic",
  {
    id: serial("id").primaryKey(),
    day: date("day").notNull().unique(),
    desktop: integer("desktop").notNull().default(0),
    mobile: integer("mobile").notNull().default(0),
  },
  (table) => [index("traffic_day_idx").on(table.day)]
)

export const schema = {
  ...authSchema,
  ...githubSchema,
  user,
  sections,
  traffic,
}
