/**
 * Pushes the day's repository data to subscribed peers.
 *
 * The source app's `build-daily-data` fetched every repository from GitHub,
 * recorded a snapshot, and then sent a webhook callback per repository. The
 * fetching and snapshot work is now owned by `update-github-data` (02:00) and
 * `snapshot-stars` (05:00), both of which run earlier in the day, so the part
 * that was unique to this task is the delivery: building one callback per
 * repository from the rows that were refreshed hours ago.
 *
 * The callbacks are the consumer's contract — the same `repo_updated` shape
 * the source sent, with the same `task_name`, so a peer does not need to know
 * that the producing task changed its name. Signature and legacy bearer token
 * follow the webhook config (`GITHUB_DATA_WEBHOOK_URL` etc.), not a task, so
 * retargeting delivery never means editing a task file.
 *
 * Deprecated and hidden projects are skipped, matching every other public
 * surface: a peer should not be told to advertise work that is deliberately
 * off the site.
 *
 * A run with no webhook endpoints configured is not a failure: the data was
 * already built and stored, and a notification consumer is optional.
 */

import { listAllProjects } from "@/lib/github/service/project"
import { syncEnv } from "@/lib/env"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"
import {
  createRepoWebhookRequest,
  type RepoWebhookSource,
} from "@/lib/webhook/repo-webhook"
import {
  summarise,
  sendWebhook,
  type WebhookResult,
} from "@/lib/webhook/client"

export type WebhookSender = (
  urls: string[],
  payload: unknown,
  options?: Parameters<typeof sendWebhook>[2]
) => Promise<WebhookResult[]>

export interface BuildDailyDataOptions {
  /** Injected in tests; defaults to reading the webhook env. */
  sender?: WebhookSender
  secret?: string
  token?: string
  endpoints?: string[]
  now?: () => Date
}

export function createBuildDailyDataTask(
  options: BuildDailyDataOptions = {}
): Task {
  return {
    name: "build-daily-data",
    description:
      "Push the day's repository data to the configured webhook endpoints, " +
      "one callback per repository",

    async run({ db, logger }) {
      const env = syncEnv()
      const endpoints = options.endpoints ?? env.GITHUB_DATA_WEBHOOK_URL
      const secret = options.secret ?? env.GITHUB_DATA_WEBHOOK_SECRET
      const token = options.token ?? env.DAILY_WEBHOOK_TOKEN
      const sender = options.sender ?? sendWebhook
      const now = options.now ?? (() => new Date())

      if (endpoints.length === 0) {
        logger.warn(
          "GITHUB_DATA_WEBHOOK_URL is not set; nothing was dispatched"
        )
        return { processed: 0, pushed: 0, failed: 0, endpoints: 0 }
      }

      // A project per repo, deduplicated: a repository with several projects
      // must not be pushed once per project, because the peer stores repos.
      const projects = (await listAllProjects(db)).filter(
        (project) => project.status !== "deprecated"
      )
      const byRepo = new Map<string, (typeof projects)[number]>()
      for (const project of projects) byRepo.set(project.repoId, project)

      const startedAt = Date.now()
      const loop = await processItems(
        [...byRepo.values()],
        async (project) => {
          const repo = project.repo as unknown as RepoWebhookSource
          const request = createRepoWebhookRequest(
            project.type,
            repo,
            {
              icon_processed: false,
              description_translated: false,
              readme_translated: false,
              og_image_processed: false,
              release_note_translated: false,
            },
            {
              task_name: "update-github-data",
              processed_at: now().toISOString(),
              processing_time_ms: Date.now() - startedAt,
              success: true,
            }
          )

          const results = await sender(endpoints, request, { secret, token })
          const accepted = results.some((result) => result.success)

          logger.info(
            `pushed ${project.repo.owner}/${project.repo.name}: ` +
              summarise(results)
          )

          return {
            meta: { processed: 1, pushed: accepted ? 1 : 0 },
            data: null,
          }
        },
        { logger, label: "repo" }
      )

      return {
        processed: loop.meta.processed ?? 0,
        pushed: loop.meta.pushed ?? 0,
        failed: (loop.meta.processed ?? 0) - (loop.meta.pushed ?? 0),
        errors: loop.meta.error ?? 0,
        endpoints: endpoints.length,
      }
    },
  }
}
