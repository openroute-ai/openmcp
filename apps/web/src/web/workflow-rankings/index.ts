import { and, count, desc, eq, gte, inArray, lte, lt, sql } from 'drizzle-orm'
import {
  authors,
  workflowComments,
  workflowDownloads,
  workflowLikes,
  workflowRankings,
  workflows,
  workflowVerifications,
  workflowViews,
} from '@workspace/db'
import { db } from '@/lib/db'

/**
 * Workflow ranking reads and the periodic recomputation.
 *
 * `workflow_rankings` is a snapshot table: one row per (workflow, dimension,
 * period, date) holding that period's counters, the composite score, and the
 * rank movement against the previous period. Rows are written only by
 * `calculateAndSaveRankings`, which the cron routes drive — reads never
 * aggregate the raw event tables, so a page load stays cheap regardless of how
 * many view rows exist.
 */

export type RankingDimension = 'recent' | 'popular'
export type RankingPeriod = 'daily' | 'weekly' | 'monthly'

/** Weights for the two composite scores. Views are the cheapest signal to farm, so they count least. */
const RECENT_WEIGHTS = {
  views: 0.1,
  downloads: 2.0,
  likes: 1.5,
  comments: 1.0,
  verifications: 3.0,
} as const

const POPULAR_WEIGHTS = {
  views: 0.5,
  downloads: 3.0,
  likes: 2.0,
  comments: 1.5,
  verifications: 5.0,
} as const

/** Platform certification bonus added to the popularity score. */
const CERTIFIED_BONUS = 10

/** A "recent" workflow loses 10% of its weight per day since publication. */
const DAILY_TIME_DECAY = 0.1

const toDateString = (date: Date) => date.toISOString().slice(0, 10)

/** Monday of the week containing `date`. */
function startOfWeek(date: Date): Date {
  const result = new Date(date)
  const dayOfWeek = result.getDay()
  result.setDate(result.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek))
  return result
}

/**
 * The canonical `date` a snapshot for this period is filed under.
 *
 * One anchor per period, used by both the cron writer and every reader, so a
 * page and its snapshot always agree on the key:
 *   - daily   → the day itself
 *   - weekly  → the Monday
 *   - monthly → the 1st
 */
function getPeriodAnchor(period: RankingPeriod, date: Date): Date {
  if (period === 'weekly') return startOfWeek(date)
  if (period === 'monthly') return new Date(date.getFullYear(), date.getMonth(), 1)
  return date
}

/** The most recent snapshot date for a dimension/period, used when the caller omits one. */
async function resolveLatestDate(dimension: RankingDimension, period: RankingPeriod) {
  const [latest] = await db
    .select({ date: workflowRankings.date })
    .from(workflowRankings)
    .where(and(eq(workflowRankings.dimension, dimension), eq(workflowRankings.period, period)))
    .orderBy(desc(workflowRankings.date))
    .limit(1)

  return latest?.date ?? null
}

export const workflowRankingsDataAccess = {
  /**
   * One period's ranking, joined to the workflow and its author.
   *
   * Unpublished workflows are filtered out here rather than at write time: a
   * workflow can be archived after its snapshot was taken, and the list must
   * not advertise it.
   */
  async getWorkflowRankings(params: {
    dimension: RankingDimension
    period: RankingPeriod
    date?: string
    limit?: number
    offset?: number
  }) {
    const { dimension, period, limit = 20, offset = 0 } = params

    const targetDate = params.date ?? (await resolveLatestDate(dimension, period))
    if (!targetDate) return []

    return db
      .select({
        id: workflowRankings.id,
        workflowId: workflowRankings.workflowId,
        dimension: workflowRankings.dimension,
        period: workflowRankings.period,
        date: workflowRankings.date,
        rank: workflowRankings.rank,
        rankChange: workflowRankings.rankChange,
        trend: workflowRankings.trend,
        popularityScore: workflowRankings.popularityScore,
        recentViews: workflowRankings.recentViews,
        recentDownloads: workflowRankings.recentDownloads,
        recentLikes: workflowRankings.recentLikes,
        recentComments: workflowRankings.recentComments,
        recentVerifications: workflowRankings.recentVerifications,
        popularViews: workflowRankings.popularViews,
        popularDownloads: workflowRankings.popularDownloads,
        popularLikes: workflowRankings.popularLikes,
        popularComments: workflowRankings.popularComments,
        popularVerifications: workflowRankings.popularVerifications,
        publishedAt: workflowRankings.publishedAt,
        updatedAt: workflowRankings.updatedAt,
        calculatedAt: workflowRankings.calculatedAt,
        workflow: {
          id: workflows.id,
          referenceId: workflows.referenceId,
          slug: workflows.slug,
          title: workflows.title,
          description: workflows.description,
          descriptionEn: workflows.descriptionEn,
          summary: workflows.summary,
          imageUrl: workflows.imageUrl,
          priceType: workflows.priceType,
          complexity: workflows.complexity,
          certified: workflows.certified,
          views: workflows.views,
          downloads: workflows.downloads,
          likes: workflows.likes,
          publishedAt: workflows.publishedAt,
        },
        author: {
          id: authors.id,
          name: authors.name,
          username: authors.username,
          avatar: authors.avatar,
          verified: authors.verified,
        },
      })
      .from(workflowRankings)
      .innerJoin(workflows, eq(workflowRankings.workflowId, workflows.id))
      .innerJoin(authors, eq(workflows.authorId, authors.id))
      .where(
        and(
          eq(workflowRankings.dimension, dimension),
          eq(workflowRankings.period, period),
          eq(workflowRankings.date, targetDate),
          eq(workflows.status, 'published')
        )
      )
      .orderBy(workflowRankings.rank)
      .limit(limit)
      .offset(offset)
  },

  /**
   * Total for a period, so a paginated view can render page controls.
   *
   * `date` is already resolved by the caller for this to match the page size.
   */
  async getWorkflowRankingsCount(params: {
    dimension: RankingDimension
    period: RankingPeriod
    date: string
  }) {
    const [result] = await db
      .select({ value: count() })
      .from(workflowRankings)
      .innerJoin(workflows, eq(workflowRankings.workflowId, workflows.id))
      .where(
        and(
          eq(workflowRankings.dimension, params.dimension),
          eq(workflowRankings.period, params.period),
          eq(workflowRankings.date, params.date),
          eq(workflows.status, 'published')
        )
      )

    return result?.value ?? 0
  },

  /** One workflow's rank movement across recent periods, newest first. */
  async getWorkflowRankingHistory(params: {
    workflowId: string
    dimension: RankingDimension
    period: RankingPeriod
    limit?: number
  }) {
    const { workflowId, dimension, period, limit = 30 } = params

    return db
      .select({
        id: workflowRankings.id,
        date: workflowRankings.date,
        weekStart: workflowRankings.weekStart,
        monthStart: workflowRankings.monthStart,
        rank: workflowRankings.rank,
        rankChange: workflowRankings.rankChange,
        trend: workflowRankings.trend,
        popularityScore: workflowRankings.popularityScore,
        recentViews: workflowRankings.recentViews,
        recentDownloads: workflowRankings.recentDownloads,
        recentLikes: workflowRankings.recentLikes,
        recentComments: workflowRankings.recentComments,
        recentVerifications: workflowRankings.recentVerifications,
        popularViews: workflowRankings.popularViews,
        popularDownloads: workflowRankings.popularDownloads,
        popularLikes: workflowRankings.popularLikes,
        popularComments: workflowRankings.popularComments,
        popularVerifications: workflowRankings.popularVerifications,
        calculatedAt: workflowRankings.calculatedAt,
      })
      .from(workflowRankings)
      .where(
        and(
          eq(workflowRankings.workflowId, workflowId),
          eq(workflowRankings.dimension, dimension),
          eq(workflowRankings.period, period)
        )
      )
      .orderBy(desc(workflowRankings.date))
      .limit(limit)
  },

  /**
   * Recompute one dimension/period over `[startDate, endDate]` and replace that
   * snapshot.
   *
   * Both dimensions read the same five event counters for the window, so a
   * daily cron run only needs one pass over the data; the scores differ purely
   * in their weights.
   *
   * The write is delete-then-insert scoped to `(dimension, period, date)`, which
   * is what makes a re-run for the same window idempotent: the unique index
   * guarantees at most one row per workflow afterwards. Rewriting the window
   * rather than merging is deliberate — a backfilled period must not inherit
   * counters from a partial first attempt.
   */
  async calculateAndSaveRankings(params: {
    dimension: RankingDimension
    period: RankingPeriod
    startDate: Date
    endDate: Date
  }) {
    const { dimension, period, startDate, endDate } = params

    // `date` is the period's own anchor — the day itself for daily, the Monday
    // for weekly, the 1st for monthly — because every reader looks a snapshot
    // up by that anchor (see `lastWeekStart` / `lastMonthStart`). Storing the
    // window's `endDate` instead, which is what the window resolver returns,
    // would make weekly and monthly rows unreachable: the query would ask for
    // the Monday and the row would be filed under the Sunday.
    const dateStr = toDateString(getPeriodAnchor(period, startDate))
    const weekStart = period === 'weekly' ? toDateString(startOfWeek(startDate)) : null
    const monthStart =
      period === 'monthly' ? toDateString(new Date(startDate.getFullYear(), startDate.getMonth(), 1)) : null

    const publishedWorkflows = await db
      .select({
        id: workflows.id,
        publishedAt: workflows.publishedAt,
        updatedAt: workflows.updatedAt,
        certified: workflows.certified,
      })
      .from(workflows)
      .where(eq(workflows.status, 'published'))

    if (publishedWorkflows.length === 0) return

    const workflowIds = publishedWorkflows.map((workflow) => workflow.id)

    const [viewsStats, downloadsStats, likesStats, commentsStats, verificationsStats] = await Promise.all([
      db
        .select({ workflowId: workflowViews.workflowId, value: sql<number>`count(*)::int` })
        .from(workflowViews)
        .where(
          and(
            inArray(workflowViews.workflowId, workflowIds),
            gte(workflowViews.viewedAt, startDate),
            lte(workflowViews.viewedAt, endDate)
          )
        )
        .groupBy(workflowViews.workflowId),

      db
        .select({ workflowId: workflowDownloads.workflowId, value: sql<number>`count(*)::int` })
        .from(workflowDownloads)
        .where(
          and(
            inArray(workflowDownloads.workflowId, workflowIds),
            gte(workflowDownloads.downloadedAt, startDate),
            lte(workflowDownloads.downloadedAt, endDate)
          )
        )
        .groupBy(workflowDownloads.workflowId),

      db
        .select({ workflowId: workflowLikes.workflowId, value: sql<number>`count(*)::int` })
        .from(workflowLikes)
        .where(
          and(
            inArray(workflowLikes.workflowId, workflowIds),
            gte(workflowLikes.createdAt, startDate),
            lte(workflowLikes.createdAt, endDate)
          )
        )
        .groupBy(workflowLikes.workflowId),

      db
        .select({ workflowId: workflowComments.workflowId, value: sql<number>`count(*)::int` })
        .from(workflowComments)
        .where(
          and(
            inArray(workflowComments.workflowId, workflowIds),
            eq(workflowComments.status, 'published'),
            gte(workflowComments.createdAt, startDate),
            lte(workflowComments.createdAt, endDate)
          )
        )
        .groupBy(workflowComments.workflowId),

      db
        .select({ workflowId: workflowVerifications.workflowId, value: sql<number>`count(*)::int` })
        .from(workflowVerifications)
        .where(
          and(
            inArray(workflowVerifications.workflowId, workflowIds),
            eq(workflowVerifications.verificationType, 'successful'),
            gte(workflowVerifications.verifiedAt, startDate),
            lte(workflowVerifications.verifiedAt, endDate)
          )
        )
        .groupBy(workflowVerifications.workflowId),
    ])

    const toCountMap = (rows: Array<{ workflowId: string; value: number }>) =>
      new Map(rows.map((row) => [row.workflowId, row.value]))

    const viewsMap = toCountMap(viewsStats)
    const downloadsMap = toCountMap(downloadsStats)
    const likesMap = toCountMap(likesStats)
    const commentsMap = toCountMap(commentsStats)
    const verificationsMap = toCountMap(verificationsStats)

    const now = Date.now()
    const dayMs = 1000 * 60 * 60 * 24

    const scored = publishedWorkflows.map((workflow) => {
      const views = viewsMap.get(workflow.id) ?? 0
      const downloads = downloadsMap.get(workflow.id) ?? 0
      const likes = likesMap.get(workflow.id) ?? 0
      const comments = commentsMap.get(workflow.id) ?? 0
      const verifications = verificationsMap.get(workflow.id) ?? 0

      const interactionScore =
        views * RECENT_WEIGHTS.views +
        downloads * RECENT_WEIGHTS.downloads +
        likes * RECENT_WEIGHTS.likes +
        comments * RECENT_WEIGHTS.comments +
        verifications * RECENT_WEIGHTS.verifications

      // An unpublished-at-all workflow falls back to a zero multiplier rather
      // than a large one, so it cannot outrank real engagement on recency alone.
      const daysSincePublished = workflow.publishedAt
        ? Math.floor((now - workflow.publishedAt.getTime()) / dayMs)
        : 999
      const timeDecayFactor = Math.max(0, 1 - daysSincePublished * DAILY_TIME_DECAY)

      return {
        workflowId: workflow.id,
        recentScore: timeDecayFactor * (100 + interactionScore),
        popularityScore:
          views * POPULAR_WEIGHTS.views +
          downloads * POPULAR_WEIGHTS.downloads +
          likes * POPULAR_WEIGHTS.likes +
          comments * POPULAR_WEIGHTS.comments +
          verifications * POPULAR_WEIGHTS.verifications +
          (workflow.certified ? CERTIFIED_BONUS : 0),
        publishedAt: workflow.publishedAt,
        updatedAt: workflow.updatedAt,
        recentViews: views,
        recentDownloads: downloads,
        recentLikes: likes,
        recentComments: comments,
        recentVerifications: verifications,
      }
    })

    if (dimension === 'recent') {
      scored.sort((a, b) => {
        // Anything more than a day apart is ordered by publication date, so the
        // list reads as "newest arrivals"; same-day neighbours fall back to the
        // decayed engagement score.
        if (a.publishedAt && b.publishedAt) {
          const timeDiff = b.publishedAt.getTime() - a.publishedAt.getTime()
          if (Math.abs(timeDiff) > dayMs) return timeDiff
        }
        return b.recentScore - a.recentScore
      })
    } else {
      scored.sort((a, b) => b.popularityScore - a.popularityScore)
    }

    // Trend needs the previous period's ranks. Read the ranks *before* the
    // delete below, otherwise a re-run would compare a window against itself.
    const [previousSnapshot] = await db
      .select({ date: workflowRankings.date })
      .from(workflowRankings)
      .where(
        and(
          eq(workflowRankings.dimension, dimension),
          eq(workflowRankings.period, period),
          lt(workflowRankings.date, dateStr)
        )
      )
      .orderBy(desc(workflowRankings.date))
      .limit(1)

    let previousRankMap = new Map<string, number>()
    if (previousSnapshot) {
      const previousRows = await db
        .select({ workflowId: workflowRankings.workflowId, rank: workflowRankings.rank })
        .from(workflowRankings)
        .where(
          and(
            eq(workflowRankings.dimension, dimension),
            eq(workflowRankings.period, period),
            eq(workflowRankings.date, previousSnapshot.date)
          )
        )

      previousRankMap = new Map(previousRows.map((row) => [row.workflowId, row.rank]))
    }

    const insertData = scored.map((entry, index) => {
      const rank = index + 1
      const previousRank = previousRankMap.get(entry.workflowId)
      // Positive means it climbed: it was ranked worse last period.
      const rankChange = previousRank ? previousRank - rank : 0

      let trend: 'up' | 'down' | 'stable' | 'new' = 'new'
      if (previousRank !== undefined) {
        if (rankChange > 0) trend = 'up'
        else if (rankChange < 0) trend = 'down'
        else trend = 'stable'
      }

      return {
        workflowId: entry.workflowId,
        dimension,
        period,
        date: dateStr,
        weekStart,
        monthStart,
        rank,
        recentViews: entry.recentViews,
        recentDownloads: entry.recentDownloads,
        recentLikes: entry.recentLikes,
        recentComments: entry.recentComments,
        recentVerifications: entry.recentVerifications,
        publishedAt: entry.publishedAt,
        updatedAt: entry.updatedAt,
        // Both dimensions were computed from the same window, so the popular*
        // counters duplicate the recent* ones.
        popularViews: entry.recentViews,
        popularDownloads: entry.recentDownloads,
        popularLikes: entry.recentLikes,
        popularComments: entry.recentComments,
        popularVerifications: entry.recentVerifications,
        popularityScore: entry.popularityScore.toString(),
        previousRank: previousRank ?? null,
        rankChange,
        trend,
        metadata: {},
        calculatedAt: new Date(),
      }
    })

    if (insertData.length === 0) return

    await db.transaction(async (tx) => {
      await tx
        .delete(workflowRankings)
        .where(
          and(
            eq(workflowRankings.dimension, dimension),
            eq(workflowRankings.period, period),
            eq(workflowRankings.date, dateStr)
          )
        )

      await tx.insert(workflowRankings).values(insertData)
    })
  },
}
