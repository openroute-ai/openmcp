import { NextResponse } from 'next/server'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import {
  isValidRankingDate,
  isWindowIncomplete,
  resolveRankingWindow,
  toDateKey,
} from '@/lib/cron/ranking-window'
import { workflowRankingsDataAccess, type RankingPeriod } from '@/web/workflow-rankings'

export const dynamic = 'force-dynamic'

/**
 * Daily ranking sweep: yesterday's snapshot always, plus the last completed week
 * on Mondays and the last completed month on the 1st.
 *
 * This is the single-entry variant for deployments that only want one scheduled
 * job. The per-period routes under `/api/cron/workflow-rankings/*` do the same
 * work and are better suited to an external scheduler that runs each period on
 * its own cadence.
 *
 * Week and month runs are gated on the current date rather than recomputed
 * unconditionally: recomputing last week's numbers every day would overwrite a
 * snapshot that a later backfill might legitimately have corrected.
 *
 * Env:
 *   CRON_SECRET - required outside development; see `@/lib/cron/authorize`
 */
export async function GET(request: Request) {
  const unauthorized = assertCronAuthorized(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  const force = url.searchParams.get('force') === 'true'

  if (dateParam && !isValidRankingDate(dateParam)) {
    return NextResponse.json({ success: false, error: 'date 必须为 YYYY-MM-DD' }, { status: 400 })
  }

  const now = new Date()
  const isMonday = now.getDay() === 1
  const isFirstOfMonth = now.getDate() === 1

  const results = {
    daily: emptyResult(),
    // `executed` is written below, so it must widen to `boolean` — a `false as
    // const` would make the later assignment a literal-type error.
    weekly: { ...emptyResult(), executed: false as boolean },
    monthly: { ...emptyResult(), executed: false as boolean },
  }

  const runPeriod = async (period: RankingPeriod, label: string) => {
    const window = resolveRankingWindow(period, dateParam)

    if (!dateParam && !force && isWindowIncomplete(window)) {
      return { success: true, skipped: true, error: `${label}周期尚未结束` }
    }

    for (const dimension of ['recent', 'popular'] as const) {
      try {
        await workflowRankingsDataAccess.calculateAndSaveRankings({ dimension, period, ...window })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[cron] ${label} ${dimension} 计算失败:`, message)
        return { success: false, skipped: false, error: message }
      }
    }

    return { success: true, skipped: false, error: null }
  }

  try {
    Object.assign(results.daily, await runPeriod('daily', '日排行'))

    if (isMonday) {
      results.weekly.executed = true
      Object.assign(results.weekly, await runPeriod('weekly', '周排行'))
    }

    if (isFirstOfMonth) {
      results.monthly.executed = true
      Object.assign(results.monthly, await runPeriod('monthly', '月排行'))
    }

    const allSuccess =
      results.daily.success &&
      (!results.weekly.executed || results.weekly.success) &&
      (!results.monthly.executed || results.monthly.success)

    const window = resolveRankingWindow('daily', dateParam)

    return NextResponse.json({
      success: allSuccess,
      message: allSuccess ? '排行计算完成' : '部分排行计算失败',
      data: {
        daily: results.daily,
        weekly: results.weekly,
        monthly: results.monthly,
      },
      window: { startDate: toDateKey(window.startDate), endDate: toDateKey(window.endDate) },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron] 排行任务执行失败:', message)
    return NextResponse.json(
      { success: false, error: message, data: results, timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return GET(request)
}

function emptyResult() {
  return { success: false, skipped: false, error: null as string | null }
}
