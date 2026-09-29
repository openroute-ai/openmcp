import { a2aAgentsRouter } from '@/web/a2a-agents/router'
import { adminA2aAgentsRouter } from '@/web/a2a-agents/router-admin'
import { dashboardRouter } from './web/dashboard'
import { apiKeysRouter } from './web/apiKeys'
import { authorsRouter } from '@/web/authors/router'
import { adminAuthorsRouter } from '@/web/authors/router-admin'
import { categoriesRouter } from '@/web/categories/router'
import { adminCategoriesRouter } from '@/web/categories/router-admin'
import { mcpServersRouter } from '@/web/mcp-servers/router'
import { adminMcpServersRouter } from '@/web/mcp-servers/router-admin'
import { mcpToolsRouter } from '@/web/mcp-tools/router'
import { newslettersRouter } from '@/web/newsletter/router'
import { personasRouter } from '@/web/personas/router'
import { providersRouter } from '@/web/providers/router'
import { rechargeOrdersRouter } from '@/web/recharge-orders/router'
import { adminRechargeRouter } from '@/web/recharge-orders/router-admin'
import { adminRechargeOrdersRouter } from '@/web/recharge-orders/router-admin-orders'
import { adminProvidersRouter } from '@/web/providers/router-admin'
import { skillsRouter } from '@/web/skills/router'
import { workflowsRouter } from '@/web/workflows/router'
import { adminWorkflowsRouter } from '@/web/workflows/router-admin'
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
  dashboard: dashboardRouter,
  apiKeys: apiKeysRouter,
  categories: categoriesRouter,
  workflows: workflowsRouter,
  authors: authorsRouter,
  skills: skillsRouter,
  personas: personasRouter,
  mcpTools: mcpToolsRouter,
  providers: providersRouter,
  recharge: rechargeOrdersRouter,
  mcpServers: mcpServersRouter,
  a2aAgents: a2aAgentsRouter,
  newsletters: newslettersRouter,

  // Admin routes
  admin: router({
    authors: adminAuthorsRouter,
    categories: adminCategoriesRouter,
    workflows: adminWorkflowsRouter,
    providers: adminProvidersRouter,
    a2aAgents: adminA2aAgentsRouter,
    mcpServers: adminMcpServersRouter,
    recharge: adminRechargeRouter,
    rechargeOrders: adminRechargeOrdersRouter,
  }),
})

export type AppRouter = typeof appRouter

export type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
export * from './trpc'
