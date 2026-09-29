import { createCallerFactory, createTRPCRouter } from "./init"
import { authorsRouter } from "./routers/authors"
import { overviewRouter } from "./routers/overview"
import { projectsRouter } from "./routers/projects"
import { rankingsRouter } from "./routers/rankings"
import { reposRouter } from "./routers/repos"
import { skillsRouter } from "./routers/skills"
import { syncRouter } from "./routers/sync"
import { tagsRouter } from "./routers/tags"
import { tasksRouter } from "./routers/tasks"

export const appRouter = createTRPCRouter({
  authors: authorsRouter,
  overview: overviewRouter,
  projects: projectsRouter,
  rankings: rankingsRouter,
  repos: reposRouter,
  skills: skillsRouter,
  sync: syncRouter,
  tags: tagsRouter,
  tasks: tasksRouter,
})

export type AppRouter = typeof appRouter

export const createCaller = createCallerFactory(appRouter)
