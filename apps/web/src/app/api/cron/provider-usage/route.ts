import { NextResponse } from 'next/server'
import { isLiteLLMConfigured } from '@workspace/litellm'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import { syncProviderUsage } from '@/lib/litellm/provider-usage'

export const dynamic = 'force-dynamic'

/**
 * Scheduled job — gateway spend settlement (LiteLLM → balance debit + provider
 * revenue share + usage report).
 *
 * This endpoint does more than build a report: it **debits user balances**.
 * Callers must therefore treat a re-run as a side-effecting operation, even
 * though the `request_id` unique constraint guarantees a single LiteLLM log
 * can never be charged twice.
 *
 * The normal cadence is driven in-process by `@/lib/cron/local-cron`
 * (every 5 minutes, no auth needed since it calls the function directly).
 * This endpoint is for manual backfills (`?days=30` after a first deploy) and
 * for deployments that prefer an external scheduler. Either way `request_id`
 * makes overlap harmless.
 *
 * Env:
 *   CRON_SECRET - required outside development; see `@/lib/cron/authorize`
 *
 * Query:
 *   ?days=N - lookback window (default 1, i.e. yesterday + today; use `?days=30`
 *             to backfill after first deploy). Capped at 90.
 */
async function handle(request: Request) {
  const unauthorized = assertCronAuthorized(request)
  if (unauthorized) return unauthorized

  if (!isLiteLLMConfigured()) {
    return NextResponse.json(
      { success: true, skipped: true, error: 'LiteLLM 未配置，跳过' },
      { status: 200 }
    )
  }

  const url = new URL(request.url)
  const daysParam = Number.parseInt(url.searchParams.get('days') || '1', 10)
  const days = Number.isFinite(daysParam) && daysParam >= 1 ? Math.min(daysParam, 90) : 1

  try {
    const result = await syncProviderUsage(days)

    return NextResponse.json({
      success: result.success,
      skipped: result.skipped,
      error: result.error || null,
      data: {
        days,
        totalLogs: result.totalLogs,
        matched: result.matched,
        inserted: result.inserted,
        duplicates: result.duplicates,
        orphaned: result.orphaned,
        debitedAmount: result.debitedAmount,
        overspendAmount: result.overspendAmount,
        resyncedUsers: result.resyncedUsers.length,
        earningsCreated: result.earningsCreated,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('网关消费结算任务执行失败:', errorMessage)
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return handle(request)
}

/** Allowed so the job can be triggered by hand. */
export async function POST(request: Request) {
  return handle(request)
}
