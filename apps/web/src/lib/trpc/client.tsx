'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink, loggerLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { useState, type ReactNode } from 'react'
import superjson from 'superjson'
import type { AppRouter } from '@/server/routers'
import { authClient } from '@/lib/auth-client'

export const trpc = createTRPCReact<AppRouter>()

/**
 * tRPC client for imperative calls outside React (event handlers, plain
 * client components).
 */
export const clientApi = trpc.createClient({
  links: [
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === 'development' ||
        (opts.direction === 'down' && opts.result instanceof Error),
    }),
    httpBatchLink({
      url: '/api/trpc',
      maxURLLength: 14000,
      transformer: superjson,
      headers: async () => {
        const session = await authClient.getSession()
        if (session instanceof Error || !session?.data?.session?.token) {
          return {}
        }
        return {
          Authorization: `Bearer ${session.data.session.token}`,
          'x-trpc-source': 'client',
        }
      },
    }),
  ],
})

export const getBaseQueryOptions = () => ({
  queries: {
    // Data is cheap to refetch and changes often, so keep windows short.
    staleTime: 30 * 1000,
  },
})

/**
 * Providers for every client component that calls tRPC hooks.
 *
 * The `QueryClient` lives in `useState` so each browser session gets one
 * instance; creating it during render would produce a new cache on every
 * render and lose all cached data.
 */
export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: getBaseQueryOptions(),
      })
  )

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === 'development' ||
            (opts.direction === 'down' && opts.result instanceof Error),
        }),
        httpBatchLink({
          url: '/api/trpc',
          maxURLLength: 14000,
          transformer: superjson,
          headers: async () => {
            const session = await authClient.getSession()
            if (session instanceof Error || !session?.data?.session?.token) {
              return {}
            }
            return {
              Authorization: `Bearer ${session.data.session.token}`,
              'x-trpc-source': 'client',
            }
          },
        }),
      ],
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
