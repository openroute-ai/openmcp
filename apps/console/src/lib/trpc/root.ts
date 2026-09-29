import { createCallerFactory, createTRPCRouter } from "./init"
import { overviewRouter } from "./routers/overview"
import { projectsRouter } from "./routers/projects"
import { rankingsRouter } from "./routers/rankings"
import { skillsRouter } from "./routers/skills"
import { syncRouter } from "./routers/sync"
import { tasksRouter } from "./routers/tasks"

export const appRouter = createTRPCRouter({
  overview: overviewRouter,
  projects: projectsRouter,
  rankings: rankingsRouter,
  skills: skillsRouter,
  sync: syncRouter,
  tasks: tasksRouter,
})

export type AppRouter = typeof appRouter

export const createCaller = createCallerFactory(appRouter)
