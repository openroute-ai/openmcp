import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from "@/server/routers/trpc"
import { categoriesDataAccess } from './index'

export const categoriesRouter = createTRPCRouter({
  /**
   * 获取所有分类（带工作流数量统计）
   */
  getAllCategories: publicProcedure.query(async () => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const categories = await categoriesDataAccess.getAllCategories(locale)
      return {
        success: true,
        data: categories,
      }
    } catch (error) {
      console.error('获取分类列表失败:', error)
      return {
        success: false,
        error: '获取分类列表失败',
      }
    }
  }),

  /**
   * 根据 slug 获取分类详情
   */
  getCategoryBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const category = await categoriesDataAccess.getCategoryBySlug(input.slug, locale)
      if (!category) {
        return {
          success: false,
          error: '分类未找到',
        }
      }
      return {
        success: true,
        data: category,
      }
    } catch (error) {
      console.error('获取分类详情失败:', error)
      return {
        success: false,
        error: '获取分类详情失败',
      }
    }
  }),

  /**
   * 获取分类下的工作流列表
   */
  getCategoryWorkflows: publicProcedure
    .input(
      z.object({
        categorySlug: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
        priceType: z.enum(['free', 'paid']).optional(),
        complexity: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        nodeTypes: z.array(z.string()).optional(),
        timePeriod: z.enum(['7d', '1m', '3m', 'all']).optional(),
        sort: z.enum(['date-desc', 'date-asc', 'downloads-desc', 'views-desc']).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const workflows = await categoriesDataAccess.getCategoryWorkflows({ ...input, locale })
        const total = await categoriesDataAccess.getCategoryWorkflowsCount(input)

        return {
          success: true,
          data: workflows,
          pagination: {
            page: input.page,
            limit: input.limit,
            total,
            totalPages: Math.ceil(total / input.limit),
          },
        }
      } catch (error) {
        console.error('获取分类工作流列表失败:', error)
        return {
          success: false,
          error: '获取分类工作流列表失败',
        }
      }
    }),
})
