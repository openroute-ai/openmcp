import * as authSchema from "@workspace/db/schema"
import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export * from "@workspace/db/schema"

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
  sections,
  traffic,
}
