import { createCallerFactory, createTRPCRouter } from "./init"
import { overviewRouter } from "./routers/overview"
import { projectsRouter } from "./routers/projects"
import { rankingsRouter } from "./routers/rankings"
import { sectionsRouter } from "./routers/sections"
import { skillsRouter } from "./routers/skills"
import { statsRouter } from "./routers/stats"
import { syncRouter } from "./routers/sync"
import { tasksRouter } from "./routers/tasks"
import { trafficRouter } from "./routers/traffic"

export const appRouter = createTRPCRouter({
  overview: overviewRouter,
  projects: projectsRouter,
  rankings: rankingsRouter,
  sections: sectionsRouter,
  skills: skillsRouter,
  stats: statsRouter,
  sync: syncRouter,
  tasks: tasksRouter,
  traffic: trafficRouter,
})

export type AppRouter = typeof appRouter

export const createCaller = createCallerFactory(appRouter)
