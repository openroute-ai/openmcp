/**
 * Sends the daily top-projects notification to WeCom.
 *
 * The source app read `trends.daily` from its static-API JSON and pushed the
 * five hottest projects to a WeCom group. The console does not store daily
 * deltas — the finest histogram it keeps is per ISO week, written by the
 * stargazer sweep — so "today" is the last complete week. The message shape is
 * unchanged, which is what matters to the reader of the chat.
 *
 * Missing WeCom configuration is a warning, not a failure: the notification is
 * the tail of a pipeline whose real output the rankings already built.
 */

import { buildRankingsForWeek } from "@/lib/github/service/rankings"
import { lastCompletePeriod } from "@/lib/tasks/tasks/build-rankings"
import { syncEnv } from "@/lib/env"
import type { Task } from "@/lib/tasks/runner"
import { hasAccepted, sendWebhook, summarise } from "@/lib/webhook/client"
import {
  buildWeWorkNewsMessage,
  projectToWeWorkArticle,
} from "@/lib/webhook/wework"
import type { WebhookSender } from "@/lib/tasks/tasks/build-daily-data"
import { SKIP_CODES } from "@/lib/trpc/error-codes"

const NUMBER_OF_PROJECTS = 5

export interface NotifyDailyOptions {
  sender?: WebhookSender
  webhookUrl?: string
  now?: () => Date
}

export function createNotifyDailyTask(options: NotifyDailyOptions = {}): Task {
  return {
    name: "notify-daily",
    description:
      "Send the top of the last complete week's ranking to the WeCom group",

    async run({ db, logger }) {
      const webhookUrl = options.webhookUrl ?? syncEnv().WEWORK_WEBHOOK_URL
      const sender = options.sender ?? sendWebhook
      const now = options.now ?? (() => new Date())

      if (!webhookUrl) {
        logger.warn("WEWORK_WEBHOOK_URL is not set; nothing to notify")
        return {
          sent: false,
          reason: "no WEWORK_WEBHOOK_URL configured",
          reasonCode: SKIP_CODES.missingNotifyWebhook,
        }
      }

      const target = lastCompletePeriod("week", now())
      const rankings = await buildRankingsForWeek(db, target, {
        limit: NUMBER_OF_PROJECTS,
      })

      if (rankings.trending.length === 0) {
        logger.warn(
          `no ranked projects for week W${String(target.week).padStart(2, "0")} ` +
            `of ${target.year}; nothing to notify`
        )
        return { sent: false, year: target.year, week: target.week }
      }

      const articles = rankings.trending.map((project, index) =>
        projectToWeWorkArticle(project, index + 1, "this week")
      )

      const results = await sender(
        [webhookUrl],
        buildWeWorkNewsMessage(articles)
      )

      logger.info(
        `notified top ${articles.length} projects: ${summarise(results)}`
      )

      return {
        sent: hasAccepted(results),
        year: target.year,
        week: target.week,
        notified: articles.length,
      }
    },
  }
}
