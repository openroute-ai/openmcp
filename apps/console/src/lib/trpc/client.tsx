"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { createTRPCContext } from "@trpc/tanstack-react-query"
import { useState } from "react"
import { makeTRPCClient } from "./client-links"
import { getQueryClient } from "./query-client"
import type { AppRouter } from "./root"

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>()

let browserClient: ReturnType<typeof makeTRPCClient> | undefined

function getTRPCClient() {
  browserClient ??= makeTRPCClient()
  return browserClient
}

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()
  const [trpcClient] = useState(getTRPCClient)

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  )
}
