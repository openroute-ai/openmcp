import * as sharedSchema from "@workspace/db/schema"
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import * as githubSchema from "./schema/github"

/**
 * Re-export shared + console github schemas. `packages/db` mcp-schema also
 * exports `repos` / `snapshots`, but those are a different physical shape
 * (marketplace `repo_snapshots`, `contributorsCount`, …). Console owns the
 * github-domain tables of the same names — prefer them explicitly so
 * `export *` is not ambiguous (TS2308) and callers keep console column types.
 */
export * from "@workspace/db/schema"
export * from "./schema/github"
export { repos, snapshots } from "./schema/github"

type SharedSchemaModule = typeof sharedSchema

/** Shared exports minus marketplace namesakes that collide with console. */
function withoutMarketplaceCollisions({
  repos: _repos,
  snapshots: _snapshots,
  schema: _schema,
  ...rest
}: SharedSchemaModule) {
  return rest
}

const sharedWithoutCollision = withoutMarketplaceCollisions(sharedSchema)

/**
 * 扩展的 user 表：在共享 auth schema 基础上增加手机号登录所需的
 * phoneNumber / phoneNumberVerified。仅 console 使用（local `user` 遮蔽
 * `export *` 重新导出的共享 user 表），避免污染 web/api 的共享 schema。
 *
 * Console DB migrations only added phone columns (0001); marketplace-only
 * fields such as role/banned/customerId stay on the shared web schema.
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

/**
 * Console drizzle schema: shared tables minus colliding marketplace
 * `repos`/`snapshots`, plus console github-domain tables and the phone-aware
 * `user`. Marketplace views such as `catalogAssets` remain on `@workspace/db`
 * for web and are not required for console better-auth typing.
 */
export const schema = {
  ...sharedWithoutCollision,
  ...githubSchema,
  user,
}

/** Auth adapter only needs better-auth tables. */
export const authSchema = {
  user,
  session: sharedSchema.session,
  account: sharedSchema.account,
  verification: sharedSchema.verification,
}
