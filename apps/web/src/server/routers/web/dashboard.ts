import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  a2aAgents,
  authors,
  categories,
  mcpServers,
  personaDownloads,
  personaFavorites,
  personas,
  providerDailyUsage,
  providerProfiles,
  rechargeOrders,
  skillDownloads,
  skillEntitlements,
  skillFavorites,
  skills,
  workflowCategories,
  workflowDownloads,
  workflowFavorites,
  workflows,
} from '@workspace/db'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'
import { marketVisible } from '@/web/assets/visibility'

/**
 * Provider dashboard statistics.
 * - access: views across every published asset
 * - downloads: downloads across every published asset
 * - favorites: likes (MCP and A2A assets have no likes column)
 * - calls / income: call count and estimated revenue over the last 30 days,
 *   rolled up from the providerDailyUsage ledger
 */
export interface ProviderStats {
  publishedAssets: { skills: number; mcpServers: number; a2aAgents: number; personas: number; total: number }
  access: number
  downloads: number
  favorites: number
  calls: number
  income: number
  callsTotal: number
  incomeTotal: number
  hasUsageData: boolean
  daily: Array<{ date: string; calls: number; spend: number }>
}

const PROVIDER_USAGE_DAYS = 30

/**
 * Roll up an author's published asset performance and usage totals.
 */
async function getProviderStats(authorId: string): Promise<ProviderStats> {
  const [skillAgg] = await db
    .select({
      total: count(),
      views: sql<number>`coalesce(sum(${skills.views}), 0)`,
      downloads: sql<number>`coalesce(sum(${skills.downloads}), 0)`,
      likes: sql<number>`coalesce(sum(${skills.likes}), 0)`,
    })
    .from(skills)
    .where(and(eq(skills.authorId, authorId), eq(skills.status, 'published')))
  const [mcpAgg] = await db
    .select({
      total: count(),
      views: sql<number>`coalesce(sum(${mcpServers.views}), 0)`,
      downloads: sql<number>`coalesce(sum(${mcpServers.downloads}), 0)`,
    })
    .from(mcpServers)
    .where(and(eq(mcpServers.authorId, authorId), marketVisible(mcpServers)))
  const [a2aAgg] = await db
    .select({
      total: count(),
      views: sql<number>`coalesce(sum(${a2aAgents.views}), 0)`,
      downloads: sql<number>`coalesce(sum(${a2aAgents.downloads}), 0)`,
    })
    .from(a2aAgents)
    .where(and(eq(a2aAgents.authorId, authorId), marketVisible(a2aAgents)))
  const [personaAgg] = await db
    .select({
      total: count(),
      views: sql<number>`coalesce(sum(${personas.views}), 0)`,
      downloads: sql<number>`coalesce(sum(${personas.downloads}), 0)`,
      likes: sql<number>`coalesce(sum(${personas.likes}), 0)`,
    })
    .from(personas)
    .where(and(eq(personas.authorId, authorId), eq(personas.status, 'published')))

  const toAsset = (agg?: { total: number; views: number; downloads: number; likes?: number }) => ({
    total: Number(agg?.total ?? 0),
    views: Number(agg?.views ?? 0),
    downloads: Number(agg?.downloads ?? 0),
    likes: Number(agg?.likes ?? 0),
  })

  const skill = toAsset(skillAgg)
  const mcp = toAsset(mcpAgg)
  const a2a = toAsset(a2aAgg)
  const persona = toAsset(personaAgg)

  // Usage rollup: last 30 days plus all-time totals.
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - PROVIDER_USAGE_DAYS)
  const sinceDate = since.toISOString().slice(0, 10)

  const [usage30d] = await db
    .select({
      calls: sql<number>`coalesce(sum(${providerDailyUsage.calls}), 0)`,
      spend: sql<number>`coalesce(sum(${providerDailyUsage.spend}), 0)`,
      tokens: sql<number>`coalesce(sum(${providerDailyUsage.tokens}), 0)`,
    })
    .from(providerDailyUsage)
    .where(and(eq(providerDailyUsage.authorId, authorId), sql`${providerDailyUsage.date} >= ${sinceDate}`))

  const [usageTotal] = await db
    .select({
      calls: sql<number>`coalesce(sum(${providerDailyUsage.calls}), 0)`,
      spend: sql<number>`coalesce(sum(${providerDailyUsage.spend}), 0)`,
    })
    .from(providerDailyUsage)
    .where(eq(providerDailyUsage.authorId, authorId))

  const dailyRows = await db
    .select({
      date: providerDailyUsage.date,
      calls: sql<number>`coalesce(sum(${providerDailyUsage.calls}), 0)`,
      spend: sql<number>`coalesce(sum(${providerDailyUsage.spend}), 0)`,
    })
    .from(providerDailyUsage)
    .where(and(eq(providerDailyUsage.authorId, authorId), sql`${providerDailyUsage.date} >= ${sinceDate}`))
    .groupBy(providerDailyUsage.date)
    .orderBy(providerDailyUsage.date)

  const daily = dailyRows.map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
    calls: Number(row.calls ?? 0),
    spend: Number(row.spend ?? 0),
  }))

  const income = Number(usage30d?.spend ?? 0)
  const calls = Number(usage30d?.calls ?? 0)

  return {
    publishedAssets: {
      skills: skill.total,
      mcpServers: mcp.total,
      a2aAgents: a2a.total,
      personas: persona.total,
      total: skill.total + mcp.total + a2a.total + persona.total,
    },
    access: skill.views + mcp.views + a2a.views + persona.views,
    downloads: skill.downloads + mcp.downloads + a2a.downloads + persona.downloads,
    favorites: skill.likes + persona.likes,
    calls,
    income,
    callsTotal: Number(usageTotal?.calls ?? 0),
    incomeTotal: Number(usageTotal?.spend ?? 0),
    hasUsageData: calls > 0 || income > 0,
    daily,
  }
}

export const dashboardRouter = createTRPCRouter({
  /**
   * Whether the current user has an approved provider profile. The sidebar
   * uses this to decide whether to show the earnings entry.
   */
  getUserProviderStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const [providerProfile] = await db
        .select({ authorId: providerProfiles.authorId })
        .from(providerProfiles)
        .where(eq(providerProfiles.userId, ctx.user.id))
        .limit(1)

      return {
        success: true,
        data: {
          isProvider: Boolean(providerProfile?.authorId),
        },
      }
    } catch (error) {
      console.error('Failed to get provider status:', error)
      return { success: false, data: { isProvider: false } }
    }
  }),

  /**
   * Everything the dashboard overview needs, in one round trip: workflow
   * favourite/download counts, recent activity, and provider stats.
   */
  getUserDashboardDataAction: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(60),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const userId = ctx.user.id

        // 1. Total favourites and downloads.
        const [favoritesCountResult] = await db
          .select({ count: count() })
          .from(workflowFavorites)
          .where(eq(workflowFavorites.userId, userId))

        const [downloadsCountResult] = await db
          .select({ count: count() })
          .from(workflowDownloads)
          .where(eq(workflowDownloads.userId, userId))

        const totalFavorites = favoritesCountResult?.count || 0
        const totalDownloads = downloadsCountResult?.count || 0

        // 2. Five most recent downloads.
        const recentDownloads = await db
          .select({
            id: workflowDownloads.id,
            workflowId: workflowDownloads.workflowId,
            downloadedAt: workflowDownloads.downloadedAt,
            workflow: {
              id: workflows.id,
              title: workflows.title,
              titleEn: workflows.titleEn,
              slug: workflows.slug,
            },
          })
          .from(workflowDownloads)
          .innerJoin(workflows, eq(workflowDownloads.workflowId, workflows.id))
          .where(eq(workflowDownloads.userId, userId))
          .orderBy(desc(workflowDownloads.downloadedAt))
          .limit(5)

        // 3. Five most recent favourites.
        const recentFavorites = await db
          .select({
            id: workflowFavorites.id,
            workflowId: workflowFavorites.workflowId,
            createdAt: workflowFavorites.createdAt,
            workflow: {
              id: workflows.id,
              title: workflows.title,
              titleEn: workflows.titleEn,
              slug: workflows.slug,
            },
          })
          .from(workflowFavorites)
          .innerJoin(workflows, eq(workflowFavorites.workflowId, workflows.id))
          .where(eq(workflowFavorites.userId, userId))
          .orderBy(desc(workflowFavorites.createdAt))
          .limit(5)

        // 4. Provider identity and stats (provider view only).
        const [providerProfile] = await db
          .select({ authorId: providerProfiles.authorId })
          .from(providerProfiles)
          .where(eq(providerProfiles.userId, userId))
          .limit(1)
        const isProvider = Boolean(providerProfile?.authorId)

        let providerStats: ProviderStats | null = null
        if (isProvider && providerProfile?.authorId) {
          providerStats = await getProviderStats(providerProfile.authorId)
        }

        return {
          success: true,
          data: {
            totals: null,
            chartData: [],
            topApiKeys: null,
            topModels: null,
            workflowStats: {
              totalFavorites,
              totalDownloads,
              recentDownloads,
              recentFavorites,
            },
            isProvider,
            providerStats,
            hasTodayData: false,
          },
        }
      } catch (error) {
        console.error('Failed to get user dashboard data:', error)
        return {
          success: false,
          error: 'Failed to get user dashboard data',
        }
      }
    }),

  /**
   * Paged list of the workflows this user has favourited.
   */
  getUserFavorites: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id
        const { page, limit } = input
        const offset = (page - 1) * limit

        // Total count.
        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowFavorites)
          .innerJoin(workflows, eq(workflowFavorites.workflowId, workflows.id))
          .where(and(eq(workflowFavorites.userId, userId), eq(workflows.status, 'published')))

        const total = totalResult?.count || 0

        // The favourited page.
        const favoritesList = await db
          .select({
            id: workflows.id,
            referenceId: workflows.referenceId,
            slug: workflows.slug,
            title: workflows.title,
            titleEn: workflows.titleEn,
            description: workflows.description,
            descriptionEn: workflows.descriptionEn,
            summary: workflows.summary,
            imageUrl: workflows.imageUrl,
            priceType: workflows.priceType,
            priceAmount: workflows.priceAmount,
            complexity: workflows.complexity,
            certified: workflows.certified,
            views: workflows.views,
            downloads: workflows.downloads,
            likes: workflows.likes,
            publishedAt: workflows.publishedAt,
            createdAt: workflows.createdAt,
            author: {
              id: authors.id,
              name: authors.name,
              username: authors.username,
              avatar: authors.avatar,
              verified: authors.verified,
            },
            favoriteCreatedAt: workflowFavorites.createdAt,
          })
          .from(workflowFavorites)
          .innerJoin(workflows, eq(workflowFavorites.workflowId, workflows.id))
          .innerJoin(authors, eq(workflows.authorId, authors.id))
          .where(and(eq(workflowFavorites.userId, userId), eq(workflows.status, 'published')))
          .orderBy(desc(workflowFavorites.createdAt))
          .limit(limit)
          .offset(offset)

        // Categories for this page of workflows.
        const workflowIds = favoritesList.map((w) => w.id)
        const workflowCategoriesList =
          workflowIds.length > 0
            ? await db
                .select({
                  workflowId: workflowCategories.workflowId,
                  category: {
                    id: categories.id,
                    name: categories.name,
                    nameEn: categories.nameEn,
                    slug: categories.slug,
                  },
                })
                .from(workflowCategories)
                .innerJoin(categories, eq(workflowCategories.categoryId, categories.id))
                .where(inArray(workflowCategories.workflowId, workflowIds))
            : []

        // Attach categories to each workflow.
        const categoriesMap = new Map<string, typeof workflowCategoriesList>()
        workflowCategoriesList.forEach((item) => {
          const existing = categoriesMap.get(item.workflowId) || []
          categoriesMap.set(item.workflowId, [...existing, item])
        })

        const workflowsWithCategories = favoritesList.map((workflow) => ({
          ...workflow,
          categories: (categoriesMap.get(workflow.id) || []).map((c) => c.category),
          nodeTypes: [] as string[],
        }))

        return {
          success: true,
          data: workflowsWithCategories,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('Failed to get user favorites:', error)
        return {
          success: false,
          error: 'Failed to get user favorites',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * Paged list of the workflows this user has downloaded.
   */
  getUserDownloads: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id
        const { page, limit } = input
        const offset = (page - 1) * limit

        // Total count.
        const [totalResult] = await db
          .select({ count: count() })
          .from(workflowDownloads)
          .innerJoin(workflows, eq(workflowDownloads.workflowId, workflows.id))
          .where(and(eq(workflowDownloads.userId, userId), eq(workflows.status, 'published')))

        const total = totalResult?.count || 0

        // The downloaded page.
        const downloadsList = await db
          .select({
            id: workflows.id,
            referenceId: workflows.referenceId,
            slug: workflows.slug,
            title: workflows.title,
            titleEn: workflows.titleEn,
            description: workflows.description,
            descriptionEn: workflows.descriptionEn,
            summary: workflows.summary,
            imageUrl: workflows.imageUrl,
            priceType: workflows.priceType,
            priceAmount: workflows.priceAmount,
            complexity: workflows.complexity,
            certified: workflows.certified,
            views: workflows.views,
            downloads: workflows.downloads,
            likes: workflows.likes,
            publishedAt: workflows.publishedAt,
            createdAt: workflows.createdAt,
            author: {
              id: authors.id,
              name: authors.name,
              username: authors.username,
              avatar: authors.avatar,
              verified: authors.verified,
            },
            downloadedAt: workflowDownloads.downloadedAt,
          })
          .from(workflowDownloads)
          .innerJoin(workflows, eq(workflowDownloads.workflowId, workflows.id))
          .innerJoin(authors, eq(workflows.authorId, authors.id))
          .where(and(eq(workflowDownloads.userId, userId), eq(workflows.status, 'published')))
          .orderBy(desc(workflowDownloads.downloadedAt))
          .limit(limit)
          .offset(offset)

        // Categories for this page of workflows.
        const workflowIds = downloadsList.map((w) => w.id)
        const workflowCategoriesList =
          workflowIds.length > 0
            ? await db
                .select({
                  workflowId: workflowCategories.workflowId,
                  category: {
                    id: categories.id,
                    name: categories.name,
                    nameEn: categories.nameEn,
                    slug: categories.slug,
                  },
                })
                .from(workflowCategories)
                .innerJoin(categories, eq(workflowCategories.categoryId, categories.id))
                .where(inArray(workflowCategories.workflowId, workflowIds))
            : []

        // Attach categories to each workflow.
        const categoriesMap = new Map<string, typeof workflowCategoriesList>()
        workflowCategoriesList.forEach((item) => {
          const existing = categoriesMap.get(item.workflowId) || []
          categoriesMap.set(item.workflowId, [...existing, item])
        })

        const workflowsWithCategories = downloadsList.map((workflow) => ({
          ...workflow,
          categories: (categoriesMap.get(workflow.id) || []).map((c) => c.category),
          nodeTypes: [] as string[],
        }))

        return {
          success: true,
          data: workflowsWithCategories,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        }
      } catch (error) {
        console.error('Failed to get user downloads:', error)
        return {
          success: false,
          error: 'Failed to get user downloads',
          data: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
        }
      }
    }),

  /**
   * "My relations": whether the user is a provider, their onboarding state,
   * their published asset counts across Skills / MCP / A2A / Personas, and the
   * network of providers whose assets they have downloaded or favourited.
   */
  getUserRelations: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id

      // 1. Provider onboarding profile.
      const [profile] = await db
        .select({
          id: providerProfiles.id,
          authorId: providerProfiles.authorId,
          entityType: providerProfiles.entityType,
          companyName: providerProfiles.companyName,
          contactName: providerProfiles.contactName,
          verificationStatus: providerProfiles.verificationStatus,
          verificationNote: providerProfiles.verificationNote,
          payChannelType: providerProfiles.payChannelType,
          payChannelStatus: providerProfiles.payChannelStatus,
          agreedTerms: providerProfiles.agreedTerms,
          createdAt: providerProfiles.createdAt,
          updatedAt: providerProfiles.updatedAt,
        })
        .from(providerProfiles)
        .where(eq(providerProfiles.userId, userId))
        .limit(1)

      // A profile row means the user is a provider: onboarding creates the
      // author identity on save.
      const isProvider = Boolean(profile?.authorId)

      // 2. The public author identity behind that profile.
      let author = null
      if (profile?.authorId) {
        const [authorRow] = await db
          .select({
            id: authors.id,
            name: authors.name,
            username: authors.username,
            avatar: authors.avatar,
            description: authors.description,
            verified: authors.verified,
          })
          .from(authors)
          .where(eq(authors.id, profile.authorId))
          .limit(1)
        author = authorRow ?? null
      }

      // 3. Published asset counts and reach (provider view only).
      const publishedAssets = { skills: 0, mcpServers: 0, a2aAgents: 0, personas: 0 }
      const audience = { totalAssets: 0, totalViews: 0, totalDownloads: 0, totalLikes: 0 }

      if (profile?.authorId) {
        const [skillAgg] = await db
          .select({
            total: count(),
            views: sql<number>`coalesce(sum(${skills.views}), 0)`,
            downloads: sql<number>`coalesce(sum(${skills.downloads}), 0)`,
            likes: sql<number>`coalesce(sum(${skills.likes}), 0)`,
          })
          .from(skills)
          .where(and(eq(skills.authorId, profile.authorId), eq(skills.status, 'published')))
        const [mcpAgg] = await db
          .select({
            total: count(),
            views: sql<number>`coalesce(sum(${mcpServers.views}), 0)`,
            downloads: sql<number>`coalesce(sum(${mcpServers.downloads}), 0)`,
          })
          .from(mcpServers)
          .where(and(eq(mcpServers.authorId, profile.authorId), marketVisible(mcpServers)))
        const [a2aAgg] = await db
          .select({
            total: count(),
            views: sql<number>`coalesce(sum(${a2aAgents.views}), 0)`,
            downloads: sql<number>`coalesce(sum(${a2aAgents.downloads}), 0)`,
          })
          .from(a2aAgents)
          .where(and(eq(a2aAgents.authorId, profile.authorId), marketVisible(a2aAgents)))
        const [personaAgg] = await db
          .select({
            total: count(),
            views: sql<number>`coalesce(sum(${personas.views}), 0)`,
            downloads: sql<number>`coalesce(sum(${personas.downloads}), 0)`,
            likes: sql<number>`coalesce(sum(${personas.likes}), 0)`,
          })
          .from(personas)
          .where(and(eq(personas.authorId, profile.authorId), eq(personas.status, 'published')))

        const toAsset = (agg?: { total: number; views: number; downloads: number; likes?: number }) => ({
          total: Number(agg?.total ?? 0),
          views: Number(agg?.views ?? 0),
          downloads: Number(agg?.downloads ?? 0),
          likes: Number(agg?.likes ?? 0),
        })

        const skillAgg2 = toAsset(skillAgg)
        const mcpAgg2 = toAsset(mcpAgg)
        const a2aAgg2 = toAsset(a2aAgg)
        const personaAgg2 = toAsset(personaAgg)

        publishedAssets.skills = skillAgg2.total
        publishedAssets.mcpServers = mcpAgg2.total
        publishedAssets.a2aAgents = a2aAgg2.total
        publishedAssets.personas = personaAgg2.total

        audience.totalAssets = skillAgg2.total + mcpAgg2.total + a2aAgg2.total + personaAgg2.total
        audience.totalViews = skillAgg2.views + mcpAgg2.views + a2aAgg2.views + personaAgg2.views
        audience.totalDownloads = skillAgg2.downloads + mcpAgg2.downloads + a2aAgg2.downloads + personaAgg2.downloads
        audience.totalLikes = skillAgg2.likes + mcpAgg2.likes + a2aAgg2.likes + personaAgg2.likes
      }

      // 4. Engagement network: providers whose assets this user touched.
      type NetworkEntry = { authorId: string; engagementCount: number }
      const networkMap = new Map<string, NetworkEntry>()
      const collectNetwork = async (rows: Array<{ authorId: string | null; engagementCount: number }>) => {
        for (const row of rows) {
          if (!row.authorId) continue
          const existing = networkMap.get(row.authorId)
          if (existing) {
            existing.engagementCount += row.engagementCount
          } else {
            networkMap.set(row.authorId, { authorId: row.authorId, engagementCount: row.engagementCount })
          }
        }
      }

      const [
        workflowDownloadNet,
        workflowFavoriteNet,
        skillDownloadNet,
        skillFavoriteNet,
        personaDownloadNet,
        personaFavoriteNet,
      ] = await Promise.all([
        db
          .select({ authorId: workflows.authorId, engagementCount: count() })
          .from(workflowDownloads)
          .innerJoin(workflows, eq(workflowDownloads.workflowId, workflows.id))
          .where(eq(workflowDownloads.userId, userId))
          .groupBy(workflows.authorId),
        db
          .select({ authorId: workflows.authorId, engagementCount: count() })
          .from(workflowFavorites)
          .innerJoin(workflows, eq(workflowFavorites.workflowId, workflows.id))
          .where(eq(workflowFavorites.userId, userId))
          .groupBy(workflows.authorId),
        db
          .select({ authorId: skills.authorId, engagementCount: count() })
          .from(skillDownloads)
          .innerJoin(skills, eq(skillDownloads.skillId, skills.id))
          .where(eq(skillDownloads.userId, userId))
          .groupBy(skills.authorId),
        db
          .select({ authorId: skills.authorId, engagementCount: count() })
          .from(skillFavorites)
          .innerJoin(skills, eq(skillFavorites.skillId, skills.id))
          .where(eq(skillFavorites.userId, userId))
          .groupBy(skills.authorId),
        db
          .select({ authorId: personas.authorId, engagementCount: count() })
          .from(personaDownloads)
          .innerJoin(personas, eq(personaDownloads.personaId, personas.id))
          .where(eq(personaDownloads.userId, userId))
          .groupBy(personas.authorId),
        db
          .select({ authorId: personas.authorId, engagementCount: count() })
          .from(personaFavorites)
          .innerJoin(personas, eq(personaFavorites.personaId, personas.id))
          .where(eq(personaFavorites.userId, userId))
          .groupBy(personas.authorId),
      ])

      await collectNetwork(workflowDownloadNet)
      await collectNetwork(workflowFavoriteNet)
      await collectNetwork(skillDownloadNet)
      await collectNetwork(skillFavoriteNet)
      await collectNetwork(personaDownloadNet)
      await collectNetwork(personaFavoriteNet)

      // Exclude self, rank by engagement, keep the top 8.
      const topNetwork = [...networkMap.values()].sort((a, b) => b.engagementCount - a.engagementCount).slice(0, 8)

      const networkAuthorIds = topNetwork.map((n) => n.authorId)
      const networkRows =
        networkAuthorIds.length > 0
          ? await db
              .select({
                id: authors.id,
                name: authors.name,
                username: authors.username,
                avatar: authors.avatar,
                description: authors.description,
                verified: authors.verified,
              })
              .from(authors)
              .where(inArray(authors.id, networkAuthorIds))
          : []

      const authorById = new Map(networkRows.map((a) => [a.id, a]))
      const network = topNetwork
        .map((n) => {
          const info = authorById.get(n.authorId)
          if (!info) return null
          return {
            author: info,
            engagementCount: n.engagementCount,
          }
        })
        .filter((n): n is NonNullable<typeof n> => n !== null)

      return {
        success: true,
        data: {
          isProvider,
          providerProfile: profile ?? null,
          author,
          publishedAssets,
          audience,
          network,
        },
      }
    } catch (error) {
      console.error('Failed to get user relations:', error)
      return { success: false, error: 'Failed to get user relations' }
    }
  }),

  /**
   * Consumer usage events MVP: union of skill downloads, skill purchases, and recharges.
   * MCP/A2A consumer call logs are not yet stored per-user; reserved type values kept for UI filters.
   */
  getUsageEvents: protectedProcedure
    .input(
      z
        .object({
          startDate: z.string().optional(), // YYYY-MM-DD
          endDate: z.string().optional(),
          type: z
            .enum(['all', 'mcp_call', 'a2a_call', 'skill_download', 'skill_purchase', 'recharge'])
            .default('all'),
          limit: z.number().min(1).max(200).default(100),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      try {
        const userId = ctx.user.id
        const type = input?.type ?? 'all'
        const limit = input?.limit ?? 100
        const start = input?.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : undefined
        const end = input?.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : undefined

        type UsageEvent = {
          id: string
          time: string
          resource: string
          type: 'mcp_call' | 'a2a_call' | 'skill_download' | 'skill_purchase' | 'recharge'
          quantity: number
          amount: number
          status: string
        }

        const events: UsageEvent[] = []

        if (type === 'all' || type === 'skill_download') {
          const downloadConds = [eq(skillDownloads.userId, userId)]
          if (start) downloadConds.push(gte(skillDownloads.downloadedAt, start))
          if (end) downloadConds.push(lte(skillDownloads.downloadedAt, end))

          const downloads = await db
            .select({
              id: skillDownloads.id,
              downloadedAt: skillDownloads.downloadedAt,
              skillTitle: skills.title,
              skillSlug: skills.slug,
            })
            .from(skillDownloads)
            .leftJoin(skills, eq(skillDownloads.skillId, skills.id))
            .where(and(...downloadConds))
            .orderBy(desc(skillDownloads.downloadedAt))
            .limit(limit)

          for (const row of downloads) {
            events.push({
              id: `dl_${row.id}`,
              time: row.downloadedAt.toISOString(),
              resource: row.skillTitle || row.skillSlug || 'Skill',
              type: 'skill_download',
              quantity: 1,
              amount: 0,
              status: 'completed',
            })
          }
        }

        if (type === 'all' || type === 'skill_purchase') {
          const purchaseConds = [eq(skillEntitlements.userId, userId)]
          if (start) purchaseConds.push(gte(skillEntitlements.createdAt, start))
          if (end) purchaseConds.push(lte(skillEntitlements.createdAt, end))

          const purchases = await db
            .select({
              id: skillEntitlements.id,
              createdAt: skillEntitlements.createdAt,
              amount: skillEntitlements.amount,
              skillTitle: skills.title,
              skillSlug: skills.slug,
            })
            .from(skillEntitlements)
            .leftJoin(skills, eq(skillEntitlements.skillId, skills.id))
            .where(and(...purchaseConds))
            .orderBy(desc(skillEntitlements.createdAt))
            .limit(limit)

          for (const row of purchases) {
            events.push({
              id: `buy_${row.id}`,
              time: row.createdAt.toISOString(),
              resource: row.skillTitle || row.skillSlug || 'Skill',
              type: 'skill_purchase',
              quantity: 1,
              amount: Number(row.amount ?? 0),
              status: 'completed',
            })
          }
        }

        if (type === 'all' || type === 'recharge') {
          const rechargeConds = [eq(rechargeOrders.userId, userId)]
          if (start) rechargeConds.push(gte(rechargeOrders.createdAt, start))
          if (end) rechargeConds.push(lte(rechargeOrders.createdAt, end))

          const recharges = await db
            .select({
              id: rechargeOrders.id,
              createdAt: rechargeOrders.createdAt,
              amount: rechargeOrders.amount,
              status: rechargeOrders.status,
              paymentMethod: rechargeOrders.paymentMethod,
              orderId: rechargeOrders.orderId,
            })
            .from(rechargeOrders)
            .where(and(...rechargeConds))
            .orderBy(desc(rechargeOrders.createdAt))
            .limit(limit)

          for (const row of recharges) {
            events.push({
              id: `rc_${row.id}`,
              time: row.createdAt.toISOString(),
              resource: row.orderId || row.paymentMethod || 'Recharge',
              type: 'recharge',
              quantity: 1,
              amount: Number(row.amount ?? 0),
              status: row.status === 'paid' ? 'completed' : row.status === 'pending' ? 'processing' : row.status,
            })
          }
        }

        events.sort((a, b) => (a.time < b.time ? 1 : -1))
        const sliced = events.slice(0, limit)

        // Month summary (calendar month UTC+8 approx via local ISO date string from client preferred;
        // server uses current month in UTC for MVP)
        const now = new Date()
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        const inMonth = sliced.filter((e) => new Date(e.time) >= monthStart)
        const monthSpend = inMonth
          .filter((e) => e.type === 'skill_purchase')
          .reduce((sum, e) => sum + e.amount, 0)
        const callCount = inMonth.filter((e) => e.type === 'mcp_call' || e.type === 'a2a_call').length
        const downloadCount = inMonth.filter((e) => e.type === 'skill_download').length

        return {
          success: true,
          data: {
            events: sliced,
            summary: {
              monthSpend,
              callCount,
              downloadCount,
            },
          },
        }
      } catch (error) {
        console.error('Failed to get usage events:', error)
        return {
          success: false,
          error: 'Failed to get usage events',
          data: { events: [], summary: { monthSpend: 0, callCount: 0, downloadCount: 0 } },
        }
      }
    }),

  /**
   * Monthly billing rollups derived from the same usage event sources.
   */
  getMonthlyBilling: protectedProcedure
    .input(z.object({ months: z.number().min(1).max(36).default(12) }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const userId = ctx.user.id
        const months = input?.months ?? 12
        const since = new Date()
        since.setUTCMonth(since.getUTCMonth() - (months - 1))
        since.setUTCDate(1)
        since.setUTCHours(0, 0, 0, 0)

        const [downloads, purchases, recharges] = await Promise.all([
          db
            .select({
              month: sql<string>`to_char(${skillDownloads.downloadedAt}, 'YYYY-MM')`,
              count: count(),
            })
            .from(skillDownloads)
            .where(and(eq(skillDownloads.userId, userId), gte(skillDownloads.downloadedAt, since)))
            .groupBy(sql`to_char(${skillDownloads.downloadedAt}, 'YYYY-MM')`),
          db
            .select({
              month: sql<string>`to_char(${skillEntitlements.createdAt}, 'YYYY-MM')`,
              count: count(),
              total: sql<number>`coalesce(sum(${skillEntitlements.amount}), 0)`,
            })
            .from(skillEntitlements)
            .where(and(eq(skillEntitlements.userId, userId), gte(skillEntitlements.createdAt, since)))
            .groupBy(sql`to_char(${skillEntitlements.createdAt}, 'YYYY-MM')`),
          db
            .select({
              month: sql<string>`to_char(${rechargeOrders.createdAt}, 'YYYY-MM')`,
              count: count(),
              total: sql<number>`coalesce(sum(${rechargeOrders.amount}), 0)`,
            })
            .from(rechargeOrders)
            .where(
              and(
                eq(rechargeOrders.userId, userId),
                eq(rechargeOrders.status, 'paid'),
                gte(rechargeOrders.createdAt, since)
              )
            )
            .groupBy(sql`to_char(${rechargeOrders.createdAt}, 'YYYY-MM')`),
        ])

        const byMonth = new Map<
          string,
          { month: string; spend: number; recharge: number; downloads: number; purchases: number; calls: number }
        >()

        const ensure = (month: string) => {
          if (!byMonth.has(month)) {
            byMonth.set(month, {
              month,
              spend: 0,
              recharge: 0,
              downloads: 0,
              purchases: 0,
              calls: 0,
            })
          }
          return byMonth.get(month)!
        }

        for (const row of downloads) {
          const m = ensure(row.month)
          m.downloads = Number(row.count ?? 0)
        }
        for (const row of purchases) {
          const m = ensure(row.month)
          m.purchases = Number(row.count ?? 0)
          m.spend = Number(row.total ?? 0)
        }
        for (const row of recharges) {
          const m = ensure(row.month)
          m.recharge = Number(row.total ?? 0)
        }

        const list = Array.from(byMonth.values()).sort((a, b) => (a.month < b.month ? 1 : -1))

        return { success: true, data: list }
      } catch (error) {
        console.error('Failed to get monthly billing:', error)
        return { success: false, error: 'Failed to get monthly billing', data: [] }
      }
    }),
})
