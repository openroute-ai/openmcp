import {
  account,
  bundles,
  capabilities,
  hallOfFame,
  hallOfFameToProjects,
  packages,
  projectSkills,
  projects,
  projectsToCapabilities,
  projectsToTags,
  projectSyncJobs,
  readmeSyncJobs,
  repoDailyStars,
  repoWeeklyStars,
  repos,
  risingStarCategories,
  risingStarProjects,
  session,
  snapshots,
  tags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
  user,
  verification,
} from "./schema"

/**
 * The schema entry point drizzle-kit reads, kept separate from
 * `src/db/schema.ts` so that the two can disagree about breadth on purpose.
 *
 * drizzle-kit does not read the runtime `schema` object — it imports this
 * module and walks **every export** looking for table objects. `src/db/schema.ts`
 * re-exports `./schema/github` wholesale and adds the `relations` helpers, so
 * pointing drizzle-kit there hands it all twenty-five of console's tables
 * anyway; the separation that matters is that this file lists them
 * *individually*, so adding a table anywhere else does not silently add it to
 * console's migrations.
 *
 * The list is explicit, which means a table added to `./schema/github.ts` is
 * not picked up until it is named here. `drizzle-kit generate` does not warn;
 * the symptom is a table that exists in TypeScript and not in the database,
 * and the first request that touches it fails at runtime.
 */

/** better-auth core + the `phoneNumber` plugin's identity columns. */
export { account, session, user, verification }

/** console's own GitHub tables; see `src/db/schema/github.ts`. */
export {
  bundles,
  capabilities,
  hallOfFame,
  hallOfFameToProjects,
  packages,
  projectSkills,
  projects,
  projectsToCapabilities,
  projectsToTags,
  projectSyncJobs,
  readmeSyncJobs,
  repoDailyStars,
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
