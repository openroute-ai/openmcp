import { createCallerFactory, createTRPCRouter } from "./init"
import { rankingsRouter } from "./routers/rankings"
import { sectionsRouter } from "./routers/sections"
import { statsRouter } from "./routers/stats"
import { trafficRouter } from "./routers/traffic"

export const appRouter = createTRPCRouter({
  rankings: rankingsRouter,
  sections: sectionsRouter,
  stats: statsRouter,
  traffic: trafficRouter,
})

export type AppRouter = typeof appRouter

export const createCaller = createCallerFactory(appRouter)
