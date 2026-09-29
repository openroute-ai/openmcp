import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { createTRPCContext } from "@/lib/trpc/context"
import { appRouter } from "@/lib/trpc/root"

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `[trpc] error on ${path ?? "<no-path>"}: ${error.message}`
            )
          }
        : undefined,
  })

export { handler as GET, handler as POST }
