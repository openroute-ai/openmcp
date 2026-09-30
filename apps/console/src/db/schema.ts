import * as authSchema from "@workspace/db/schema"
import * as githubSchema from "./schema/github"

export * from "@workspace/db/schema"
export * from "./schema/github"

/**
 * `repos` and `snapshots` exist in both the shared schema and console's own
 * GitHub tables, and `export *` cannot decide between them: TypeScript reports
 * TS2308 and drops the name entirely, so every console caller would silently
 * resolve to the *shared* table instead. That table has `contributorsCount`
 * where console's data has `contributorCount`, and a per-day `month` column
 * where console stores an aggregated `months` array, which is where every
 * schema type error in the GitHub services came from.
 *
 * An explicit re-export resolves the ambiguity in favour of console's tables,
 * which are the ones the `drizzle-kit` migrations under `src/db/drizzle` were
 * generated from and the only ones the console queries.
 */
export { repos, snapshots } from "./schema/github"

/**
 * The Better Auth `user` table, extended with the columns the phoneNumber
 * plugin needs.
 *
 * The shared table already carries `phoneNumber` / `phoneNumberVerified` plus
 * `role`, `banned`, `banReason`, `banExpires` and `customerId`. Console
 * previously redeclared the table from scratch, which kept the phone columns but
 * dropped the five Better Auth fields, and Better Auth refused every request
 * with `SCHEMA_MISMATCH / missing-column user.role`. Redeclaring a table also
 * silently diverges from the shared definition the moment either side adds a
 * field, so the shared table is reused as-is instead.
 */
const { user, ...sharedAuthSchema } = authSchema

export const schema = {
  ...sharedAuthSchema,
  ...githubSchema,
  user,
}
