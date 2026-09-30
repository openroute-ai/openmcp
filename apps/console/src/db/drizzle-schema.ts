import {
  account,
  session,
  verification,
} from "@workspace/db/schema"
import {
  bundles,
  hallOfFame,
  hallOfFameToProjects,
  packages,
  projectSkills,
  projects,
  projectsToTags,
  projectSyncJobs,
  readmeSyncJobs,
  repoWeeklyStars,
  repos,
  risingStarCategories,
  risingStarProjects,
  snapshots,
  tags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
} from "./schema/github"
import { user } from "./schema"

/**
 * The schema entry point drizzle-kit reads, kept separate from
 * `src/db/schema.ts` so that the two can disagree about breadth on purpose.
 *
 * `src/db/schema.ts` re-exports `@workspace/db/schema` wholesale
 * (`export * from "@workspace/db/schema"`), which is what the runtime wants:
 * `@workspace/auth` and the console's own services import `user`,
 * `session`, `account` and friends from there. drizzle-kit, though, does not
 * read the runtime `schema` object — it imports this module and walks every
 * export looking for table objects. Pointing it at `src/db/schema.ts` therefore
 * hands it the entire shared schema: `blog_posts`, `workflows`, `personas`,
 * `mcp_servers`, `provider_earnings` and several hundred more, none of which
 * console owns or queries. `drizzle-kit generate` against it emitted a
 * thousand-line migration full of `CREATE TABLE` for other apps' tables, and
 * `drizzle-kit push` against it would have offered to drop them.
 *
 * So the managed set is enumerated here instead: the four better-auth tables
 * console's auth instance actually writes, and console's own eighteen GitHub
 * tables. Two consequences worth knowing:
 *
 * - The list is explicit, so a table added to either source file is *not*
 *   picked up until it is named here. `drizzle-kit generate` will not warn; the
 *   symptom is a column that exists in TypeScript and not in the database, and
 *   better-auth fails at runtime with `42703` rather than at build time.
 * - `user` comes from `./schema`, not from `@workspace/db/schema`. Both declare
 *   a `pgTable("user")` with the same columns, but console's copy is the one
 *   that adds `role`, the phone-number pair and better-auth's ban columns, and
 *   the runtime `schema` object lists it last so it wins the key. Naming the
 *   shared one here instead would generate a migration for the wrong `user`
 *   table — and because drizzle keys tables by name, the two would collide.
 */

/** better-auth core + the `phoneNumber` plugin's identity columns. */
export { account, session, user, verification }

/** console's own GitHub tables; see `src/db/schema/github.ts`. */
export {
  bundles,
  hallOfFame,
  hallOfFameToProjects,
  packages,
  projectSkills,
  projects,
  projectsToTags,
  projectSyncJobs,
  readmeSyncJobs,
  repoWeeklyStars,
  repos,
  risingStarCategories,
  risingStarProjects,
  snapshots,
  tags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
}
