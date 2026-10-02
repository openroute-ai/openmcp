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
import { runScheduledHealthChecks } from '@/lib/health-check/scheduled-check'
import { purgeExpiredOAuthStates } from '@/lib/agent-install/oauth-state'
import { settleGatewaySpend } from '@/lib/litellm/settlement'
import {
  autoConfirmOverdueStatements,
  generateStatements,
  statementConfirmDeadline,
  statementGenerateDate,
  settlementPeriodFor,
} from '@/web/providers/statements'

/** One job: a name for logs, an interval, and the work itself. */
interface Job {
  name: string
  intervalMs: number
  run: () => Promise<unknown>
  /**
   * Extra precondition beyond `ENABLE_LOCAL_CRON`. Returning false skips this
   * job but leaves the others running — necessary because the jobs do not
   * depend on the same infrastructure: the gateway jobs need LiteLLM, the
   * monthly statements need only the database.
   */
  enabled?: () => boolean
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
  enabled: () => isLiteLLMConfigured(),
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

/**
 * 月度结算：出账 + 逾期自动确认。
 *
 * 每小时跑一次而不是每天一次，因为它是**日期驱动**的：函数自己判断"今天
 * 是否过了 5 日 / 19 日"，没过就直接返回。小时级的意义只是把"漏跑一天"
 * 的窗口从 24 小时压到 1 小时 —— 出账日早上 6 点前没跑也不影响，因为打款
 * 在 20 日，还有 15 天缓冲。
 *
 * 每天一次反而更脆：凌晨 3 点那一轮失败，第二天早上才重试。
 */
const statementsJob: Job = {
  name: 'provider-statements',
  intervalMs: envInt('PROVIDER_STATEMENTS_INTERVAL_SEC', 3600, 60) * 1000,
  run: async () => {
    const now = new Date()
    const period = settlementPeriodFor(now)
    const gate = statementGenerateDate(period)

    if (now < gate) {
      return { period, gated: true, created: 0, autoConfirmed: 0 }
    }

    const generated = await generateStatements(now, { period })
    const confirmed = await autoConfirmOverdueStatements(now)

    console.log(
      `[cron/statements] period=${period} created=${generated.created} rolled=${generated.rolled} ` +
        `skipped=${generated.skipped} autoConfirmed=${confirmed.autoConfirmed}/${confirmed.checked}` +
        (generated.errors.length ? ` generateErrors=${generated.errors.join('; ')}` : '') +
        (confirmed.errors.length ? ` confirmErrors=${confirmed.errors.join('; ')}` : '')
    )

    return {
      period,
      gated: false,
      created: generated.created,
      rolled: generated.rolled,
      // `statementConfirmDeadline` 记在这里只为让日志与出账单处于同一套日期
      // 计算下：出账单建出来了但确认截止日已经过去，是需要立刻排查的状态。
      confirmDeadline: statementConfirmDeadline(period).toISOString(),
      autoConfirmed: confirmed.autoConfirmed,
      errors: [...generated.errors, ...confirmed.errors],
    }
  },
}

/**
 * 清理过期的 provider OAuth `state` nonce。
 *
 * 纯 housekeeping：过期 nonce 本来就过不了 `verifyOAuthState` 的 TTL 检查，
 * 留着只是让表变大。所以清理失败只记日志，不升级成告警。
 *
 * 每天一次即可 —— 过期窗口是 10 分钟，多留一天没有任何语义差别。
 */
const oauthStateCleanupJob: Job = {
  name: 'oauth-state-cleanup',
  intervalMs: envInt('OAUTH_STATE_CLEANUP_INTERVAL_SEC', 86400, 300) * 1000,
  run: async () => {
    const removed = await purgeExpiredOAuthStates()
    if (removed > 0) {
      console.log(`[cron/oauth-state] purged ${removed} expired state nonce row(s)`)
    }
    return { removed }
  },
}

/**
 * 定时健康检查：探测开了开关的已发布 MCP / A2A，更新可达性状态。
 *
 * 间隔 10 分钟。间隔的下限语义是**故障可见延迟**，不是安全边界——真正的边界是
 * 连续失败阈值（`HEALTH_CHECK_FAIL_THRESHOLD`，默认 3），所以就算探测晚了一轮，
 * 也不会有资产被提前下架；反过来调小间隔也不会让单次抖动就下架。
 *
 * 不需要 LiteLLM：探测直连提供方端点，所以没有加 `enabled` 前置条件——网关结算
 * 那两个任务需要 LiteLLM，而这一条不需要。
 */
const assetHealthJob: Job = {
  name: 'asset-health-check',
  intervalMs: envInt('ASSET_HEALTH_CHECK_INTERVAL_SEC', 600, 60) * 1000,
  run: async () => {
    const summaries = await runScheduledHealthChecks()
    for (const s of summaries) {
      if (s.checked > 0) {
        console.log(
          `[cron/asset-health] ${s.kind} checked=${s.checked} healthy=${s.healthy} ` +
            `degraded=${s.degraded} offline=${s.takenOffline} recovered=${s.recovered}`
        )
      }
      // 探测函数抛错（配置错误、解密失败）要显式打出来：这些不会被计入失败次数，
      // 所以不会触发下架，只靠计数会让人以为"检查过了没问题"。
      for (const err of s.errors) console.warn(`[cron/asset-health] ${s.kind} ${err}`)
    }
    return summaries
  },
}

const jobs: Job[] = [settlementJob, statementsJob, oauthStateCleanupJob, assetHealthJob]

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
  // Gating moved to per-job `enabled`. A single global LiteLLM check used to
  // take down the whole scheduler, which meant a deployment without LiteLLM
  // also silently lost the monthly statements job — the one job whose absence
  // delays real money.
  const active = jobs.filter((job) => job.enabled?.() ?? true)
  const skipped = jobs.filter((job) => !(job.enabled?.() ?? true))

  for (const name of skipped.map((job) => job.name)) {
    console.log(`[cron] ${name} 前置条件不满足，已跳过`)
  }

  if (active.length === 0) {
    console.log('[cron] 没有可运行的任务')
    return
  }

  started = true

  for (const job of active) {
    const initial = setTimeout(() => {
      void runGuarded(job)
      const timer = setInterval(() => void runGuarded(job), job.intervalMs)
      timer.unref?.()
    }, job.intervalMs)
    initial.unref?.()
  }

  console.log(
    `[cron] 已启动 ${active.length} 个任务：` +
      active.map((job) => `${job.name}@${Math.round(job.intervalMs / 1000)}s`).join(', ')
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
