import { createCallerFactory, createTRPCRouter } from "./init"
import { apiKeysRouter } from "./routers/api-keys"
import { authorsRouter } from "./routers/authors"
import { consoleRouter } from "./routers/console"
import { decisionsRouter } from "./routers/decisions"
import { overviewRouter } from "./routers/overview"
import { projectsRouter } from "./routers/projects"
import { rankingsRouter } from "./routers/rankings"
import { reposRouter } from "./routers/repos"
import { sessionsRouter } from "./routers/sessions"
import { skillsRouter } from "./routers/skills"
import { subscriptionsRouter } from "./routers/subscriptions"
import { syncRouter } from "./routers/sync"
import { tagsRouter } from "./routers/tags"
import { tasksRouter } from "./routers/tasks"
import { usersRouter } from "./routers/users"

export const appRouter = createTRPCRouter({
  // 开放 API 的凭据。签发走这里而不是 `/api/v1`，理由见 `routers/api-keys.ts`
  // 的文件头。
  apiKeys: apiKeysRouter,
  authors: authorsRouter,
  // The user console's own numbers, scoped to the caller's submissions. Separate
  // from `overview`, which counts the whole registry for an operator.
  console: consoleRouter,
  decisions: decisionsRouter,
  overview: overviewRouter,
  projects: projectsRouter,
  rankings: rankingsRouter,
  repos: reposRouter,
  // §6.7：订阅的自助页与管理员治理页共用这一个 router，归属由 service 层的
  // `ownerCondition` 决定，页面没有权限判断。
  subscriptions: subscriptionsRouter,
  // Accounts and their sessions sit together under the same gate: a session row
  // without the account it belongs to cannot answer "who is this", and an account
  // page without its sessions cannot answer "is this one still signed in".
  sessions: sessionsRouter,
  skills: skillsRouter,
  sync: syncRouter,
  tags: tagsRouter,
  tasks: tasksRouter,
  users: usersRouter,
})

export type AppRouter = typeof appRouter

export const createCaller = createCallerFactory(appRouter)
