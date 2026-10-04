import {
  account,
  apiKeys,
  apiRequestAudit,
  bundles,
  capabilities,
  categories,
  decisionBoards,
  decisionCandidates,
  hallOfFame,
  hallOfFameToProjects,
  newsletterSubscription,
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
  repoAnomalies,
  repoLicenseHistory,
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
  subscriptions,
  tags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
  user,
  webhookDeliveries,
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
 * pointing drizzle-kit there hands it all thirty-three of console's tables
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

/**
 * 开放 API 的调用凭据与它的审计日志；见 `src/db/schema/api-keys.ts` 与
 * `src/db/schema/api-request-audit.ts`。
 *
 * 两张表具名导出而不是 `export *`，理由是这个文件顶上那段说的：不具名的话
 * drizzle-kit 不会知道要管它们，而 `push` 会提出把一张只在 TypeScript 里存在的
 * 表删掉。
 */
export { apiKeys, apiRequestAudit }

/**
 * 订阅与投递队列（设计文档 §6.1）。
 *
 * 同样单独具名：`subscriptions` 同时引用 `api_keys` 与 `user`，`webhook_deliveries`
 * 引用 `subscriptions`，两张都属于"跨了两个域"的那一组，理由与下面 `userRepos` 相同。
 * `subscriptions` 里那条 CHECK（归属恰好一个非空）也由 drizzle-kit 从这里读到。
 */
export { subscriptions, webhookDeliveries }

/**
 * 谁提交了哪个仓库。
 *
 * 在 auth 这一组而不是 GitHub 那一组，因为它同时引用 `user` 和 `repos`——这张
 * 表属于两边，放在哪一组都只是位置，但它讲的是"提交"这件事，而这正是
 * `/console` 的全部内容。
 */
export { userRepos }

/**
 * 决策工作台的两张表。
 *
 * 它们同时引用 `user` 与 `repos`，所以既不属于下面那组 GitHub 表、也不属于上面
 * 那组 auth 表——`userRepos` 有同样的处境，处置方式也一样：单独具名导出，而不是
 * 混进任何一组里让"这一组是 GitHub 域的表"这句话不再成立。
 */
export { decisionBoards, decisionCandidates }

/**
 * 订阅选型周刊的邮箱。
 *
 * 与 auth 那一组分开具名，因为它是「谁留下了邮箱」而不是身份：邮箱可以属于一个
 * 已登录用户，也可以属于一个还没注册的访客，`user_id` 因此可空。
 */
export { newsletterSubscription }

/** console's own GitHub tables; see `src/db/schema/github.ts`. */
export {
  bundles,
  capabilities,
  categories,
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
  repoAnomalies,
  repoLicenseHistory,
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
