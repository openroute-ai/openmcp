import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from "@/server/routers/trpc"
import { mcpToolsDataAccess } from './index'

export const mcpToolsRouter = createTRPCRouter({
  getMcpTools: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        search: z.string().optional(),
        skillId: z.string().optional(),
        includeDeprecated: z.boolean().optional(),
        sort: z.enum(['date-desc', 'date-asc', 'name-asc']).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const locale = (await getLocale()) as 'zh' | 'en'
        const list = await mcpToolsDataAccess.getMcpTools({ ...input, locale })
        const total = await mcpToolsDataAccess.getMcpToolsCount(input)
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
        console.error('获取 MCP 工具列表失败:', error)
        return { success: false, error: '获取 MCP 工具列表失败' }
      }
    }),

  getMcpToolById: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    try {
      const locale = (await getLocale()) as 'zh' | 'en'
      const tool = await mcpToolsDataAccess.getMcpToolById(input.id, locale)
      if (!tool) {
        return { success: false, error: '工具未找到' }
      }
      return { success: true, data: tool }
    } catch (error) {
      console.error('获取工具详情失败:', error)
      return { success: false, error: '获取工具详情失败' }
    }
  }),
})
