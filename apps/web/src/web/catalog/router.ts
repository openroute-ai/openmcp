import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from '@/server/routers/trpc'
import { recommendCatalogAssets } from './recommend'
import { searchCatalog } from './search'

const kindSchema = z.enum(['skill', 'mcp', 'a2a', 'app'])
const securitySchema = z.enum(['safe', 'caution', 'unsafe', 'reject', 'unknown'])

const searchInput = z.object({
  q: z.string().optional(),
  kind: z.union([kindSchema, z.array(kindSchema)]).optional(),
  categorySlug: z.string().optional(),
  categoryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priceType: z.enum(['free', 'paid']).optional(),
  securityGrade: securitySchema.optional(),
  certified: z.boolean().optional(),
  sort: z.enum(['hot', 'downloads', 'recent']).optional(),
  limit: z.number().min(1).max(50).optional(),
  offset: z.number().min(0).optional(),
})

const recommendInput = z.object({
  useCase: z.string().min(1).max(500),
  kind: z.union([kindSchema, z.array(kindSchema)]).optional(),
  priceType: z.enum(['free', 'paid']).optional(),
  preferFree: z.boolean().optional(),
  securityGrade: securitySchema.optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().min(1).max(20).optional(),
})

export const catalogRouter = createTRPCRouter({
  /**
   * Unified marketplace search across skill / mcp / a2a / app (workflows).
   * Default sort = hot score. Anonymous OK.
   */
  search: publicProcedure.input(searchInput).query(async ({ input }) => {
    const result = await searchCatalog(input)
    return { success: true as const, ...result }
  }),

  /**
   * Chat / AI 选型推荐。基于 search + hot ranking，带 reason 文案。
   */
  recommend: publicProcedure.input(recommendInput).query(async ({ input }) => {
    const result = await recommendCatalogAssets(input)
    return { success: true as const, ...result }
  }),
})
