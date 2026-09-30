import { NextResponse } from 'next/server'
import { isLiteLLMConfigured } from '@workspace/litellm'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import { listUsersWithGatewayKeys, syncGatewayBudgetForUsers } from '@/lib/budget/budget-sync'

export const dynamic = 'force-dynamic'

/**
 * Gateway budget backfill / self-heal: LiteLLM `max_budget` ← OpenMCP balances.
 *
 * Covers two cases:
 *  1. Keys issued before the budget fields existed have no `max_budget` on the
 *     gateway, which LiteLLM reads as "unlimited".
 *  2. A gateway hiccup during a top-up left `max_budget` out of step with the
 *     local balance; this run converges it.
 *
 * Not the settlement path — that needs the `gateway_spend_records` ledger and
 * is deliberately out of scope here. This route only ever raises or lowers a
 * spending ceiling; it never debits a balance.
 *
 * Env:
 *   CRON_SECRET - required outside development; see `@/lib/cron/authorize`
 *
 * Query:
 *   ?limit=N        - users per batch (default 200, max 500)
 *   ?onlyUnset=true - only touch keys whose gateway `max_budget` is unset or
 *                     out of step (default; `?onlyUnset=false` forces a rewrite)
 *   ?userId=<id>    - one user, for debugging; ignores `limit`
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
  const specificUserId = url.searchParams.get('userId')
  const limitParam = Number.parseInt(url.searchParams.get('limit') || '200', 10)
  const limit = Number.isFinite(limitParam) && limitParam >= 1 ? Math.min(limitParam, 500) : 200
  const onlyUnset = url.searchParams.get('onlyUnset') !== 'false'

  try {
    const userIds = specificUserId ? [specificUserId] : await listUsersWithGatewayKeys(limit)
    const result = await syncGatewayBudgetForUsers(userIds, { onlyUnset })

    return NextResponse.json({
      success: result.failed === 0,
      requested: result.total,
      synced: result.synced,
      skipped: result.skipped,
      failed: result.failed,
      onlyUnset,
      details: result.details.map((item) => ({
        userId: item.userId,
        available: item.available,
        updated: item.updated,
        failed: item.failed,
        keys: item.keys
          .filter((key) => key.changed)
          .map((key) => ({
            keyAlias: key.keyAlias,
            previousMaxBudget: key.previousMaxBudget,
            maxBudget: key.targetMaxBudget,
            keySpend: key.keySpend,
            blocked: key.targetBlocked,
            success: key.success,
            error: key.error ?? null,
          })),
      })),
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('网关预算回补任务执行失败:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
