/**
 * Notifies subscribers that a ranking has been published.
 *
 * The source app read the ranking JSON it had just published and posted the
 * top projects to a webhook. The console reads no JSON files in its tasks, and
 * the rankings are a deterministic function of the database, so the published
 * artifact is validated at build time and this task recomputes the same
 * numbers instead of round-tripping them through storage.
 *
 * The payload is the source's contract: the same `week`/`month`/`projects`
 * envelope with rank, name, stars and delta per project, so a subscriber that
 * parsed the old shape parses this one. `url` is built from the full name; the
 * source also had a site-relative project url and an icon that the console
 * does not stream, and dropping them changes the payload less than inventing
 * values that would not resolve.
 *
 * Unlike the notifications above, a missing webhook URL fails the run: this
 * task exists to notify, so it having nothing to notify to is the task itself
 * being misconfigured, not an optional tail.
 */

import { syncEnv } from "@/lib/env"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
  type Rankings,
} from "@/lib/github/service/rankings"
import { lastCompletePeriod } from "@/lib/github/snapshot-dates"
import type { Task } from "@/lib/tasks/runner"
import { hasAccepted, sendWebhook, summarise } from "@/lib/webhook/client"
import type { WebhookSender } from "@/lib/tasks/tasks/build-daily-data"

const NUMBER_OF_PROJECTS = 50

export interface TriggerRankingsOptions {
  sender?: WebhookSender
  webhookUrl?: string
  secret?: string
  token?: string
  now?: () => Date
}

const WEBHOOK_ENV: Record<"week" | "month", string> = {
  week: "WEEKLY_WEBHOOK_URL",
  month: "MONTHLY_WEBHOOK_URL",
}

export function createTriggerRankingsFinishedTask(
  period: "week" | "month",
  options: TriggerRankingsOptions = {}
): Task {
  const isWeek = period === "week"
  const name =
    period === "week" ? "trigger-weekly-finished" : "trigger-monthly-finished"

  return {
    name,
    description: `Send the ${period} ranking to the configured webhook endpoint`,

    async run({ db, logger }) {
      const env = syncEnv()
      const webhookUrl =
        options.webhookUrl ??
        (isWeek ? env.WEEKLY_WEBHOOK_URL : env.MONTHLY_WEBHOOK_URL)
      const secret = options.secret ?? env.GITHUB_DATA_WEBHOOK_SECRET
      const token = options.token ?? env.DAILY_WEBHOOK_TOKEN
      const sender = options.sender ?? sendWebhook
      const now = options.now ?? (() => new Date())

      if (!webhookUrl) {
        throw new Error(`No "${WEBHOOK_ENV[period]}" env. variable!`)
      }

      if (isWeek) {
        const target = lastCompletePeriod("week", now())
        const rankings = await buildRankingsForWeek(db, target)
        const periodLabel = `week W${String(target.week).padStart(2, "0")} of ${target.year}`

        if (rankings.trending.length === 0) {
          logger.warn(
            `no ranked projects for ${periodLabel}; nothing to notify`
          )
          return { sent: false, year: target.year, week: target.week }
        }

        const body = payload(rankings, now)
        const results = await sender([webhookUrl], body, { secret, token })
        logger.info(
          `notified ${rankings.trending.length} projects for ${periodLabel}: ` +
            summarise(results)
        )

        return {
          sent: hasAccepted(results),
          webhookTotal: results.length,
          webhookSuccessful: results.filter((result) => result.success).length,
          webhookFailed: results.filter((result) => !result.success).length,
          year: target.year,
          week: target.week,
        }
      }

      const target = lastCompletePeriod("month", now())
      const rankings = await buildRankingsForMonth(db, target)
      const periodLabel = `${target.year}-${String(target.month).padStart(2, "0")}`

      if (rankings.trending.length === 0) {
        logger.warn(`no ranked projects for ${periodLabel}; nothing to notify`)
        return { sent: false, year: target.year, month: target.month }
      }

      const body = payload(rankings, now)
      const results = await sender([webhookUrl], body, { secret, token })
      logger.info(
        `notified ${rankings.trending.length} projects for ${periodLabel}: ` +
          summarise(results)
      )

      return {
        sent: hasAccepted(results),
        webhookTotal: results.length,
        webhookSuccessful: results.filter((result) => result.success).length,
        webhookFailed: results.filter((result) => !result.success).length,
        year: target.year,
        month: target.month,
      }
    },
  }
}

/** The top projects in the source app's callback shape. */
function payload(rankings: Rankings, now: () => Date): Record<string, unknown> {
  const projects = rankings.trending
    .slice(0, NUMBER_OF_PROJECTS)
    .map((project, index) => ({
      rank: index + 1,
      name: project.name,
      full_name: project.fullName,
      description: project.description,
      stars: project.stars,
      delta: project.delta,
      url: `https://github.com/${project.fullName}`,
    }))

  return {
    year: rankings.year,
    ...("week" in rankings
      ? { week: rankings.week }
      : { month: rankings.month }),
    projects,
    total_projects: projects.length,
    timestamp: now().toISOString(),
  }
}
