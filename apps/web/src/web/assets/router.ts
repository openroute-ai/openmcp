import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'
import { db } from '@/lib/db'
import { getAuthorForUser } from '@/web/providers/author'
import {
  getAssetUsageSummary,
  getAuthorUsageSummaries,
  listBilledCalls,
  summarizeAcross,
} from './usage'
import {
  createAssetVersion,
  createVersionInput,
  listAssetVersions,
  publishAssetVersion,
  publishVersionInput,
  rollbackInput,
  rollbackToVersion,
  yankAssetVersion,
} from './versions'

/**
 * Provider 自助查询真实调用观测数据。
 *
 * 资产归属必须查库确认，不能只信调用方传进来的 assetId——账本数据是财务口径，
 * 串到别人的资产上就是跨 Provider 泄露营收数据。
 */
export const assetsRouter = createTRPCRouter({
  getUsage: protectedProcedure
    .input(
      z.object({
        assetType: z.enum(['mcp', 'a2a']),
        assetId: z.string().min(1),
        days: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return { summary: null, calls: [] }

      const owned = await ownsAsset(author.authorId, input.assetType, input.assetId)
      if (!owned) return { summary: null, calls: [] }

      const [summary, calls] = await Promise.all([
        getAssetUsageSummary(input.assetType, input.assetId, input.days),
        listBilledCalls(input.assetType, input.assetId, 14, input.days),
      ])
      return { summary, calls }
    }),

  /**
   * 版本相关操作。全部要求 author 归属（`versions.ts` 内逐个校验）。
   *
   * 版本管理是 Provider 自助能力，不进 admin：平台审核的是"这个资产能不能上架"，
   * 上架之后发第几个版本、改端点、改定价都是资产所有者自己的事。
   */
  listVersions: protectedProcedure
    .input(z.object({ kind: z.enum(['mcp', 'a2a']), assetId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return []
      return listAssetVersions(input.kind, input.assetId, author.authorId)
    }),

  createVersion: protectedProcedure
    .input(createVersionInput)
    .mutation(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return { success: false as const, error: '尚未入驻创作者' }
      return createAssetVersion({ ...input, authorId: author.authorId })
    }),

  publishVersion: protectedProcedure
    .input(publishVersionInput)
    .mutation(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return { success: false as const, error: '尚未入驻创作者' }
      return publishAssetVersion({ ...input, authorId: author.authorId })
    }),

  rollbackVersion: protectedProcedure
    .input(rollbackInput)
    .mutation(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return { success: false as const, error: '尚未入驻创作者' }
      return rollbackToVersion({ ...input, authorId: author.authorId })
    }),

  yankVersion: protectedProcedure
    .input(rollbackInput.extend({ reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return { success: false as const, error: '尚未入驻创作者' }
      return yankAssetVersion({ ...input, authorId: author.authorId })
    }),

  /** 列表页顶部汇总：一次取回名下全部资产的聚合，避免 N+1。 */
  getUsageOverview: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const author = await getAuthorForUser(ctx.session.userId)
      if (!author.authorId) return summarizeAcross([])
      const byAsset = await getAuthorUsageSummaries(author.authorId, input.days)
      return summarizeAcross([...byAsset.values()])
    }),
})

async function ownsAsset(
  authorId: string,
  assetType: 'mcp' | 'a2a',
  assetId: string
): Promise<boolean> {
  const row =
    assetType === 'a2a'
      ? await db.query.a2aAgents.findFirst({
          columns: { authorId: true },
          where: (t, { eq }) => eq(t.id, assetId),
        })
      : await db.query.mcpServers.findFirst({
          columns: { authorId: true },
          where: (t, { eq }) => eq(t.id, assetId),
        })
  return row?.authorId === authorId
}