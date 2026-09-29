import { createTRPCClient, httpBatchLink } from "@trpc/client"
import superjson from "superjson"
import type { AppRouter } from "./root"

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return ""
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  return `http://localhost:${process.env.PORT ?? 3001}`
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
