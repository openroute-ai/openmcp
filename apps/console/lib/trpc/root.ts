import { createCallerFactory, createTRPCRouter } from "./init"
import { sectionsRouter } from "./routers/sections"
import { statsRouter } from "./routers/stats"
import { trafficRouter } from "./routers/traffic"

export const appRouter = createTRPCRouter({
  sections: sectionsRouter,
  stats: statsRouter,
  traffic: trafficRouter,
})

export type AppRouter = typeof appRouter

export const createCaller = createCallerFactory(appRouter)
