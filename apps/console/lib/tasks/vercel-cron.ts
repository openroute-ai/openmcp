/**
 * The Vercel schedule that wakes the Cron endpoint.
 *
 * Vercel evaluates `crons` entries in UTC, allows one entry per project, and
 * a Hobby plan allows one invocation per day, so the tasks cannot each get an
 * entry of their own. They are scheduled in `Asia/Shanghai` instead and
 * matched against their own `cronExpression`, and this single entry exists
 * only to make sure the endpoint is awake often enough to catch all of them.
 *
 * Twice an hour, on the hour and on the half hour, because those are the only
 * two minutes the seeds use. `isDue` matches the current minute rather than
 * "since the last tick", so a task scheduled for 02:00 is due on the `0`
 * wake-up and not on the `30` one, and nothing runs twice.
 *
 * Consequence worth knowing before adding a seed: a new task scheduled at,
 * say, 17 minutes past would never run, because no wake-up lands on minute 17.
 * Add its minutes to `VERCEL_CRON_SCHEDULE` when that happens.
 */
export const VERCEL_CRON_PATH = "/api/cron/github"

export const VERCEL_CRON_SCHEDULE = "0,30 * * * *"
