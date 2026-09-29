import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from "@/server/routers/trpc"
import { personasDataAccess } from './index'

export const personasRouter = createTRPCRouter({
  getPersonas: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        categorySlugs: z.array(z.string()).optional(),
        priceType: z.enum(['free', 'paid']).optional(),
        certified: z.boolean().optional(),
        timePeriod: z.enum(['7d', '1m', '3m', 'all']).optional(),
        sort: z.enum(['date-desc', 'date-asc', 'downloads-desc', 'views-desc', 'likes-desc']).optional(),
        authorUsername: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const list = await personasDataAccess.getPersonas({ ...input, locale })
        const total = await personasDataAccess.getPersonasCount(input)
        return {
          success: true,
          data: list,
          pagination: {
            page: input.page,
            limit: input.limit,
            total,
            totalPages: Math.ceil(total / input.limit),
          },
        }
      } catch (error) {
        console.error('获取角色列表失败:', error)
        return { success: false, error: '获取角色列表失败' }
      }
    }),

  getPersonaById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const persona = await personasDataAccess.getPersonaById(input.id, locale)
      if (!persona) {
        return { success: false, error: '角色未找到' }
      }
      await personasDataAccess.incrementViews(input.id)
      return { success: true, data: persona }
    } catch (error) {
      console.error('获取角色详情失败:', error)
      return { success: false, error: '获取角色详情失败' }
    }
  }),

  getPersonaBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const persona = await personasDataAccess.getPersonaBySlug(input.slug, locale)
      if (!persona) {
        return { success: false, error: '角色未找到' }
      }
      await personasDataAccess.incrementViews(persona.id)
      return { success: true, data: persona }
    } catch (error) {
      console.error('获取角色详情失败:', error)
      return { success: false, error: '获取角色详情失败' }
    }
  }),
})
