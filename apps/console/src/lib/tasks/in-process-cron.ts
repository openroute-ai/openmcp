/**
 * The in-process scheduler that replaces Vercel Cron.
 *
 * `apps/console` runs on a domestic host, where the `crons` block in
 * `vercel.json` does not exist. The wake-up is owned by this process instead:
 * `instrumentation.ts` starts it once on boot, it derives the next 18:00 UTC
 * wake-up from the same `VERCEL_CRON_SCHEDULE` Vercel used, and it calls the
 * same `runScheduledTasks` the Cron endpoint was the front door for. The
 * schedule, the seed order and the per-task database locks do not change, so
 * this is a move from "cron reaches the route" to "the process reaches the
 * route".
 *
 * Multiple instances are safe because the runner's per-task lock is the
 * arbiter: two hosts waking at once race for the lock and only one runs each
 * task, exactly as two overlapping Vercel Cron hits would have.
 *
 * The `next build` process also loads instrumentation, so this module refuses
 * to start until it is given the all-clear — the enabled check is what keeps a
 * build from spinning a timer into an ephemeral process.
 */
import { runScheduledTasks } from "@/app/api/cron/github/route"
import { nextDueInstant } from "./schedule"
import { VERCEL_CRON_SCHEDULE } from "./vercel-cron"

/** setTimeout's argument is a signed 32-bit integer, so ~24.8 days. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

export function isInProcessCronEnabled(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.IN_PROCESS_CRON_ENABLED !== "false"
  )
}

let timer: NodeJS.Timeout | undefined
let running = false

/**
 * Starts the loop. Idempotent: instrumentation may be asked to register more
 * than once under some runtimes, and a second timer would double the wake-ups.
 */
export function startInProcessCron(): void {
  if (timer) return
  scheduleNext()
}

function scheduleNext(): void {
  const now = new Date()
  const due = nextDueInstant(VERCEL_CRON_SCHEDULE, now, { timeZone: "UTC" })
  if (!due) return
  const delay = Math.max(0, due.getTime() - now.getTime())
  timer = setTimeout(
    () => void tick(due),
    Math.min(delay, MAX_TIMEOUT_MS)
  )
}

async function tick(due: Date): Promise<void> {
  if (running) {
    // A previous wake-up is still working and holds the per-task locks. Skip
    // rather than overlap; the runner's `selectPeriod` marks the period done,
    // so the next wake-up is told there is nothing left for its tasks that ran.
    scheduleNext()
    return
  }

  running = true
  try {
    const started = Date.now()
    const response = await runScheduledTasks(due)
    const summary = (await response.json()) as {
      recovered: number
      results: Record<string, string>
    }
    console.info(
      `[in-process-cron] tick at ${due.toISOString()} finished in ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s, recovered ${summary.recovered}, ` +
        `${Object.keys(summary.results).length} tasks`
    )
  } catch (error) {
    console.error("[in-process-cron] tick failed", error)
  } finally {
    running = false
    scheduleNext()
  }
}