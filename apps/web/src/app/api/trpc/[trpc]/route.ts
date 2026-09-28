import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { createContextFromRequest } from '@/lib/trpc/server'
import { appRouter } from '@/server/routers'

/**
 * tRPC endpoint, mounted at `/api/trpc` (the user chose to keep the same path
 * the source app used, so no proxy rewrite is needed).
 */
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async (opts) => createContextFromRequest(opts.req),
  })

export { handler as GET, handler as POST }
