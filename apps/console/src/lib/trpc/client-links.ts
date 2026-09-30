import { createTRPCClient, httpBatchLink } from "@trpc/client"
import superjson from "superjson"
import type { AppRouter } from "./root"

/**
 * The origin the server-side tRPC client dials.
 *
 * `next dev` is pinned to 20002 in `package.json` and `next start` binds `PORT`,
 * so that is the fallback here; it only has to be overridden when the app is
 * deployed behind a different port. The client half of the link passes `""` and
 * stays on the browser's own origin, which is why this only runs on the server.
 */
function getBaseUrl() {
  if (typeof window !== "undefined") {
    return ""
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  return `http://localhost:${process.env.PORT ?? 20002}`
}

export function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        transformer: superjson,
        url: `${getBaseUrl()}/api/trpc`,
      }),
    ],
  })
}
