/**
 * In-process scheduled jobs (running inside the Next.js server process).
 *
 * Why this sits next to the `/api/cron/*` routes: those are for external
 * schedulers and for manual backfills. Balance write-back is a money path
 * though — if nothing in-process drives it, MCP/A2A spend only comes back when
 * someone remembers to hit the endpoint. Running it here keeps the loop
 * self-driving on plain Node hosts (self-hosted box, pm2, docker), where
 * `vercel.json` crons do not exist.
 *
 * Two properties worth knowing before scaling out:
 * 1. **Every replica runs its own copy.** Fine for a single instance or pm2
 *    `instances: 1`. Across replicas the work is merely duplicated, not
 *    double-charged: `gateway_spend_records.request_id` is unique, so one
 *    LiteLLM log can only ever be settled once. To also shed the wasted API
 *    calls, replace the `running` guard below with a DB-backed lock.
 * 2. **A restart drops one run.** Rolling restarts do not backfill. Settlement
 *    correctness does not depend on it — the next round's lookback window
 *    (`days`) covers the gap.
 */

import { isLiteLLMConfigured } from '@workspace/litellm'
import { settleGatewaySpend } from '@/lib/litellm/settlement'

/** One job: a name for logs, an interval, and the work itself. */
interface Job {
  name: string
  intervalMs: number
  run: () => Promise<unknown>
}

function envInt(name: string, fallback: number, min: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(raw) && raw >= min ? raw : fallback
}

/** Explicit kill switch: set 0 to drive the schedule by hand in development. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off'
}

/**
 * Gateway spend settlement: pull LiteLLM spend logs → debit balances
 * idempotently → push the new `max_budget` back → credit provider revenue
 * share → rebuild the daily usage report.
 *
 * Defaults to every 5 minutes. That interval is the **write-back latency** for
 * user balances, and therefore the ceiling on the overspend window. It is not a
 * safety boundary — the hard stop is LiteLLM's own `max_budget` / `blocked` —
 * so a late round only leaves the displayed balance optimistic; it does not let
 * a user spend without limit.
 */
const settlementJob: Job = {
  name: 'gateway-settlement',
  intervalMs: envInt('GATEWAY_SETTLEMENT_INTERVAL_SEC', 300, 30) * 1000,
  run: async () => {
    const days = envInt('GATEWAY_SETTLEMENT_DAYS', 1, 1)
    const result = await settleGatewaySpend(days)
    console.log(
      `[cron/settlement] days=${days} logs=${result.totalLogs} matched=${result.matched} ` +
        `inserted=${result.inserted} duplicates=${result.duplicates} orphaned=${result.orphaned} ` +
        `debit=${result.debitedAmount} overspend=${result.overspendAmount} ` +
        `resynced=${result.resyncedUsers.length} earnings=${result.earningsCreated}` +
        (result.error ? ` error=${result.error}` : '')
    )
    return result
  },
}

const jobs: Job[] = [settlementJob]

let started = false

/**
 * Boot the in-process jobs. Idempotent — repeated calls are a no-op.
 *
 * The first run is delayed by one full interval: right after boot the DB
 * connection and LiteLLM may not be ready yet, and firing immediately just
 * manufactures a burst of spurious failures.
 */
export function startLocalCronJobs(): void {
  if (started) return
  if (!envBool('ENABLE_LOCAL_CRON', true)) {
    console.log('[cron] ENABLE_LOCAL_CRON 已关闭，跳过定时任务启动')
    return
  }
  // With LiteLLM unconfigured every job would no-op, so don't spin them up.
  if (!isLiteLLMConfigured()) {
    console.log('[cron] LiteLLM 未配置（LITELLM_MASTER_KEY 为空），定时任务未启动')
    return
  }

  started = true

  for (const job of jobs) {
    const initial = setTimeout(() => {
      void runGuarded(job)
      const timer = setInterval(() => void runGuarded(job), job.intervalMs)
      timer.unref?.()
    }, job.intervalMs)
    initial.unref?.()
  }

  console.log(
    `[cron] 已启动 ${jobs.length} 个任务：` +
      jobs.map((job) => `${job.name}@${Math.round(job.intervalMs / 1000)}s`).join(', ')
  )
}

/**
 * Re-entrancy guard. A slow LiteLLM must not let two rounds stack up — they
 * would not double-charge (the `request_id` unique constraint holds), but they
 * would hit the same API concurrently.
 */
const running = new Set<string>()

async function runGuarded(job: Job): Promise<void> {
  if (running.has(job.name)) {
    console.warn(`[cron/${job.name}] 上一次执行尚未结束，跳过本轮`)
    return
  }
  running.add(job.name)
  const startedAt = Date.now()
  try {
    await job.run()
    console.log(`[cron/${job.name}] 完成，用时 ${Date.now() - startedAt}ms`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cron/${job.name}] 失败：${message}`)
  } finally {
    running.delete(job.name)
  }
}
