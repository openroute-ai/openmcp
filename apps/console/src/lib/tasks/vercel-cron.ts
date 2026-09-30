/**
 * The Vercel schedule that wakes the Cron endpoint.
 *
 * Vercel evaluates `crons` entries in UTC, allows one entry per project, and a
 * Hobby plan allows one invocation per day, so the tasks cannot each get an
 * entry of their own. They are scheduled in `Asia/Shanghai` instead and the
 * wake-up runs one cascade over them — see `@/lib/tasks/schedule`.
 *
 * Once a day, at 02:00 Asia/Shanghai, which is the earliest slot any seed
 * names. Waking at the first task's own hour means that task runs on the day it
 * is due, and every task later in the day runs for the period it was due in,
 * hours after the fact, in seed order. The wake-up does not have to land on any
 * minute a seed uses, which is what lets a new task be added at 17:47 without
 * editing this file: its period becomes outstanding at the next wake-up.
 *
 * A second consequence worth knowing: because a wake-up may run the whole
 * pipeline, the one-hour ceiling on a lower plan can cut a cascade short. That
 * is survivable rather than lossy — the tasks that were not reached are still
 * outstanding periods, so the next wake-up picks them up.
 */
export const VERCEL_CRON_PATH = "/api/cron/github"

export const VERCEL_CRON_SCHEDULE = "0 18 * * *"
