import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from "@/server/routers/trpc"
import { authorsDataAccess } from './index'

export const authorsRouter = createTRPCRouter({
  /**
   * 获取作者列表
   */
  getAuthors: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        verified: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const authors = await authorsDataAccess.getAuthors(input)
        const total = await authorsDataAccess.getAuthorsCount(input)

        return {
          success: true,
          data: authors,
          pagination: {
            page: input.page || 1,
            limit: input.limit || 20,
            total,
            totalPages: Math.ceil(total / (input.limit || 20)),
          },
        }
      } catch (error) {
        console.error('获取作者列表失败:', error)
        return {
          success: false,
          error: '获取作者列表失败',
        }
      }
    }),

  /**
   * 根据 slug 获取作者详情
   */
  getAuthorBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    try {
      const author = await authorsDataAccess.getAuthorBySlug(input.slug)
      if (!author) {
        return {
          success: false,
          error: '作者未找到',
        }
      }
      return {
        success: true,
        data: author,
      }
    } catch (error) {
      console.error('获取作者详情失败:', error)
      return {
        success: false,
        error: '获取作者详情失败',
      }
    }
  }),

  /**
   * 获取作者的工作流列表
   */
  getAuthorWorkflows: publicProcedure
    .input(
      z.object({
        authorSlug: z.string(),
        page: z.number().default(1),
        limit: z.number().default(20),
        categorySlugs: z.array(z.string()).optional(),
        priceType: z.enum(['free', 'paid']).optional(),
        complexity: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        timePeriod: z.enum(['7d', '1m', '3m', 'all']).optional(),
        sort: z.enum(['date-desc', 'date-asc', 'downloads-desc', 'views-desc']).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const workflows = await authorsDataAccess.getAuthorWorkflows(input)
        const total = await authorsDataAccess.getAuthorWorkflowsCount(input)

        return {
          success: true,
          data: workflows,
          pagination: {
            page: input.page || 1,
            limit: input.limit || 20,
            total,
            totalPages: Math.ceil(total / (input.limit || 20)),
          },
        }
      } catch (error) {
        console.error('获取作者工作流列表失败:', error)
        return {
          success: false,
          error: '获取作者工作流列表失败',
        }
      }
    }),

  /**
   * 获取作者工作流的所有分类
   */
  getAuthorWorkflowCategories: publicProcedure.input(z.object({ authorSlug: z.string() })).query(async ({ input }) => {
    try {
      const categories = await authorsDataAccess.getAuthorWorkflowCategories(input.authorSlug)
      return {
        success: true,
        data: categories,
      }
    } catch (error) {
      console.error('获取作者工作流分类失败:', error)
      return {
        success: false,
        error: '获取作者工作流分类失败',
      }
    }
  }),

  getAuthorSkillCategories: publicProcedure.input(z.object({ authorSlug: z.string() })).query(async ({ input }) => {
    try {
      const categories = await authorsDataAccess.getAuthorSkillCategories(input.authorSlug)
      return {
        success: true,
        data: categories,
      }
    } catch (error) {
      console.error('获取作者技能分类失败:', error)
      return {
        success: false,
        error: '获取作者技能分类失败',
      }
    }
  }),

  getAuthorPersonaCategories: publicProcedure.input(z.object({ authorSlug: z.string() })).query(async ({ input }) => {
    try {
      const categories = await authorsDataAccess.getAuthorPersonaCategories(input.authorSlug)
      return {
        success: true,
        data: categories,
      }
    } catch (error) {
      console.error('获取作者角色分类失败:', error)
      return {
        success: false,
        error: '获取作者角色分类失败',
      }
    }
  }),
})
