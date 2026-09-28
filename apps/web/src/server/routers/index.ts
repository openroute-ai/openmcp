import { publicProcedure, router } from './trpc'

/**
 * Liveness probe. Useful for smoke tests and uptime checks, and it is the
 * smallest possible proof that the tRPC handler, transformer and context are
 * wired up correctly.
 */
const healthRouter = router({
  ping: publicProcedure.query(() => ({ ok: true as const })),
})

/**
 * Root router. Marketplace and admin routers are registered here as they are
 * ported, one module at a time.
 */
export const appRouter = router({
  health: healthRouter,
})

export type AppRouter = typeof appRouter

export type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
export * from './trpc'
