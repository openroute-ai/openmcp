'use client'

import { httpBatchLink, loggerLink } from '@trpc/client'
import superjson from 'superjson'
import { authClient } from '@/lib/auth-client'

/** Where an unauthenticated request is redirected to. */
const LOGIN_ROUTE = '/sign-in'

/**
 * tRPC links for client components.
 *
 * The session token rides in an `Authorization` header rather than a cookie,
 * so the request is authenticated the same way whether it comes from the
 * browser or from a server component.
 */
export const trpcLinks = [
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
    fetch: async (url, options) => {
      const response = await fetch(url, options)
      if (response.status === 401 && typeof window !== 'undefined') {
        window.location.href = LOGIN_ROUTE
      }
      return response
    },
  }),
]
