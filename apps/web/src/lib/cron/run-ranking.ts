import { NextResponse } from 'next/server'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import {
  isValidRankingDate,
  isWindowIncomplete,
  resolveRankingWindow,
  toDateKey,
} from '@/lib/cron/ranking-window'
import {
  workflowRankingsDataAccess,
  type RankingDimension,
  type RankingPeriod,
} from '@/web/workflow-rankings'

export const dynamic = 'force-dynamic'

/**
 * Recompute workflow rankings for one period.
 *
 * Mounted at `/api/cron/workflow-rankings/{daily,weekly,monthly}` so each period
 * can be scheduled independently. Recomputation is scoped to a single
 * `(dimension, period, date)` snapshot and is delete-then-insert, so re-running
 * the same window is safe.
 *
 * Env:
 *   CRON_SECRET - required outside development; see `@/lib/cron/authorize`
 *
 * Query:
 *   ?date=YYYY-MM-DD - anchor day; the surrounding period is derived from it.
 *     Defaults to the most recently completed period of this kind.
 *   ?force=true - recompute even when the window has not finished, for backfills.
 */
export async function runRankingCron(
  request: Request,
  period: RankingPeriod,
  label: string
): Promise<NextResponse> {
  const unauthorized = assertCronAuthorized(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  const force = url.searchParams.get('force') === 'true'

  if (dateParam && !isValidRankingDate(dateParam)) {
    return NextResponse.json({ success: false, error: 'date 必须为 YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const window = resolveRankingWindow(period, dateParam)

    if (!dateParam && !force && isWindowIncomplete(window)) {
      return NextResponse.json(
        {
          success: true,
          skipped: true,
          error: `${label}周期尚未结束，跳过`,
          window: { startDate: toDateKey(window.startDate), endDate: toDateKey(window.endDate) },
        },
        { status: 200 }
      )
    }

    const dimensions: RankingDimension[] = ['recent', 'popular']
    const data: Record<string, { success: boolean; error: string | null }> = {}

    for (const dimension of dimensions) {
      try {
        await workflowRankingsDataAccess.calculateAndSaveRankings({ dimension, period, ...window })
        data[dimension] = { success: true, error: null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[cron] ${label} ${dimension} 计算失败:`, message)
        data[dimension] = { success: false, error: message }
      }
    }

    const allSuccess = Object.values(data).every((result) => result.success)

    return NextResponse.json({
      success: allSuccess,
      period,
      window: { startDate: toDateKey(window.startDate), endDate: toDateKey(window.endDate) },
      data,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cron] ${label} 任务执行失败:`, message)
    return NextResponse.json(
      { success: false, error: message, timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}
