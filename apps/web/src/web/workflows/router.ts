import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from "@/server/routers/trpc"
import { workflowsDataAccess } from './index'

export const workflowsRouter = createTRPCRouter({
  /**
   * 获取工作流列表
   */
  getWorkflows: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        categorySlugs: z.array(z.string()).optional(),
        priceType: z.enum(['free', 'paid']).optional(),
        complexity: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        nodeTypes: z.array(z.string()).optional(),
        certified: z.boolean().optional(),
        timePeriod: z.enum(['7d', '1m', '3m', 'all']).optional(),
        sort: z.enum(['date-desc', 'date-asc', 'downloads-desc', 'views-desc', 'popularity-desc']).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const workflows = await workflowsDataAccess.getWorkflows({ ...input, locale })
        const total = await workflowsDataAccess.getWorkflowsCount(input)

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
        console.error('获取工作流列表失败:', error)
        return {
          success: false,
          error: '获取工作流列表失败',
        }
      }
    }),

  /**
   * 根据 ID 获取工作流详情
   */
  getWorkflowById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const workflow = await workflowsDataAccess.getWorkflowById(input.id, locale)
      if (!workflow) {
        return {
          success: false,
          error: '工作流未找到',
        }
      }
      // 增加浏览次数
      await workflowsDataAccess.incrementViews(input.id)
      return {
        success: true,
        data: workflow,
      }
    } catch (error) {
      console.error('获取工作流详情失败:', error)
      return {
        success: false,
        error: '获取工作流详情失败',
      }
    }
  }),

  /**
   * 根据 slug 获取工作流详情
   */
  getWorkflowBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const workflow = await workflowsDataAccess.getWorkflowBySlug(input.slug, locale)
      if (!workflow) {
        return {
          success: false,
          error: '工作流未找到',
        }
      }
      await workflowsDataAccess.incrementViews(workflow.id)
      return {
        success: true,
        data: workflow,
      }
    } catch (error) {
      console.error('获取工作流详情失败:', error)
      return {
        success: false,
        error: '获取工作流详情失败',
      }
    }
  }),

  /**
   * 获取相关工作流
   */
  getRelatedWorkflows: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        limit: z.number().default(6),
      })
    )
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const workflows = await workflowsDataAccess.getRelatedWorkflows({ ...input, locale })
        return {
          success: true,
          data: workflows,
        }
      } catch (error) {
        console.error('获取相关工作流失败:', error)
        return {
          success: false,
          error: '获取相关工作流失败',
        }
      }
    }),

  /**
   * 下载工作流
   */
  downloadWorkflow: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        userId: z.string().optional(),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await workflowsDataAccess.incrementDownloads(input.workflowId, input.userId, input.ipAddress, input.userAgent)
        return {
          success: true,
        }
      } catch (error) {
        console.error('下载工作流失败:', error)
        return {
          success: false,
          error: '下载工作流失败',
        }
      }
    }),
})
