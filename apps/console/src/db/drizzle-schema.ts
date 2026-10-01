import {
  account,
  apiKeys,
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
  repoDailyStats,
  repoMonthlyStats,
  repoStargazers,
  repoWeeklyStats,
  repos,
  risingStarCategories,
  risingStarProjects,
  session,
  /**
   * 已停写的年度月度快照。声明它只是为了让 `push` 认得这张表、
   * 从而不会提出删掉它（生产库仍有 748 行）。没有服务读写它。
   * 详见 `schema/github.ts` 里 `snapshots` 的注释。
   */
  snapshots,
  tags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
  user,
  userRepos,
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

/** 开放 API 的调用凭据；见 `src/db/schema/api-keys.ts`。 */
export { apiKeys }

/**
 * 谁提交了哪个仓库。
 *
 * 在 auth 这一组而不是 GitHub 那一组，因为它同时引用 `user` 和 `repos`——这张
 * 表属于两边，放在哪一组都只是位置，但它讲的是"提交"这件事，而这正是
 * `/console` 的全部内容。
 */
export { userRepos }

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
  repoDailyStats,
  repoMonthlyStats,
  repoStargazers,
  repoWeeklyStats,
  repos,
  risingStarCategories,
  risingStarProjects,
  /**
   * 已停写的年度月度快照。声明它只是为了让 `push` 认得这张表、
   * 从而不会提出删掉它（生产库仍有 748 行）。没有服务读写它。
   * 详见 `schema/github.ts` 里 `snapshots` 的注释。
   */
  snapshots,
  tags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
}
