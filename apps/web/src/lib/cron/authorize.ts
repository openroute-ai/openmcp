import { NextResponse } from 'next/server'

/**
 * Shared gate for the `/api/cron/*` endpoints.
 *
 * These routes run unauthenticated work that rewrites ranking snapshots and
 * pushes wallet limits to the gateway, so they must not be callable by anyone
 * who finds the URL. The scheduler passes `Authorization: Bearer <CRON_SECRET>`.
 *
 * When `CRON_SECRET` is unset the endpoint is left open and says so loudly:
 * a deployment that forgot the secret is a deployment bug, and silently
 * requiring it would only be discovered when the job started 401ing. The
 * warning is written on every request so it shows up in the first log line of
 * the failing run.
 */
export function assertCronAuthorized(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.warn('[cron] CRON_SECRET 未配置，仅限开发环境使用')
    return null
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
