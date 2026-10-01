import { createCallerFactory, createTRPCRouter } from "./init"
import { authorsRouter } from "./routers/authors"
import { overviewRouter } from "./routers/overview"
import { projectsRouter } from "./routers/projects"
import { rankingsRouter } from "./routers/rankings"
import { reposRouter } from "./routers/repos"
import { sessionsRouter } from "./routers/sessions"
import { skillsRouter } from "./routers/skills"
import { syncRouter } from "./routers/sync"
import { tagsRouter } from "./routers/tags"
import { tasksRouter } from "./routers/tasks"
import { usersRouter } from "./routers/users"

export const appRouter = createTRPCRouter({
  authors: authorsRouter,
  overview: overviewRouter,
  projects: projectsRouter,
  rankings: rankingsRouter,
  repos: reposRouter,
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
