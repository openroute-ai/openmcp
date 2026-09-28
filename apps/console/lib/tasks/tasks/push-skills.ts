/**
 * Pushes parsed skills to the web service.
 *
 * This is the downstream half of the source app's `sync-skill-repos`: that
 * task here only fetches and stores documents, leaving the delivery to a task
 * whose entire job is delivery. The separation matters because the push is the
 * only part that can fail without the data being wrong — a dead endpoint must
 * not be able to lose a freshly parsed SKILL.md.
 *
 * The rows are read from `listSkillsNeedingPush`, the retry queue: anything
 * never pushed or whose last push failed is either sent now or given a fresh
 * error to retry next run. A successful push records `syncedToWebAt`, which
 * moves the row out of the queue.
 *
 * Unlike `build-daily-data` — where a missing endpoint leaves the day's work
 * already done — a missing webhook URL fails the run, because the endpoint is
 * the single thing this task exists to reach.
 */

import { syncEnv } from "@/lib/env"
import {
  listSkillsNeedingPushJoined,
  recordPushFailure,
  recordPushSuccess,
} from "@/lib/github/service/skill"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"
import { buildSkillWebhookPayload } from "@/lib/webhook/skill-webhook"
import type { WebhookSender } from "@/lib/tasks/tasks/build-daily-data"
import { hasAccepted, sendWebhook, summarise } from "@/lib/webhook/client"

export interface PushSkillsOptions {
  sender?: WebhookSender
  webhookUrl?: string
  secret?: string
  token?: string
  now?: () => Date
}

export function createPushSkillsTask(options: PushSkillsOptions = {}): Task {
  return {
    name: "push-skills",
    description:
      "Push every stored skill that has never been pushed, or whose last " +
      "push failed, to the skills webhook",

    async run({ db, logger }) {
      const pending = await listSkillsNeedingPushJoined(db)
      if (pending.length === 0) {
        logger.info("no skills need pushing")
        return { processed: 0, pushed: 0, failed: 0, pending: 0 }
      }

      const env = syncEnv()
      const webhookUrl = options.webhookUrl ?? env.SKILLS_WEBHOOK_URL
      if (!webhookUrl) {
        throw new Error(`No "SKILLS_WEBHOOK_URL" env. variable!`)
      }

      const secret = options.secret ?? env.GITHUB_DATA_WEBHOOK_SECRET
      const token = options.token ?? env.SKILLS_WEBHOOK_TOKEN
      const sender = options.sender ?? sendWebhook
      const now = options.now ?? (() => new Date())

      const results = await processItems(
        pending,
        async ({ skill, project, repo }) => {
          const payload = buildSkillWebhookPayload({
            repoOwner: repo.owner,
            repoName: repo.name,
            skillDir: skill.skillDir,
            name: skill.name,
            description: skill.description,
            descriptionZh: skill.descriptionZh,
            readme: skill.readme,
            readmeZh: skill.readmeZh,
            version: skill.version,
          })

          const sent = await sender([webhookUrl], payload, { secret, token })
          const accepted = hasAccepted(sent)
          const at = now()

          if (accepted) {
            await recordPushSuccess(db, skill.projectId, skill.skillDir, at)
            logger.info(
              `pushed ${repo.owner}/${repo.name} (${skill.skillDir}): ` +
                summarise(sent)
            )
          } else {
            await recordPushFailure(
              db,
              skill.projectId,
              skill.skillDir,
              summarise(sent),
              at
            )
            logger.error(
              `failed ${repo.owner}/${repo.name} (${skill.skillDir}): ` +
                `recorded for retry — ${summarise(sent)}`
            )
          }

          return {
            meta: { processed: 1, pushed: accepted ? 1 : 0 },
            data: {
              slug: project.slug,
              full_name: `${repo.owner}/${repo.name}`,
              skill_dir: skill.skillDir,
              pushed: accepted,
            },
          }
        },
        { logger, label: "skill", concurrency: 3 }
      )

      return {
        processed: results.meta.processed ?? 0,
        pushed: results.meta.pushed ?? 0,
        failed: (results.meta.processed ?? 0) - (results.meta.pushed ?? 0),
        pending: pending.length,
      }
    },
  }
}
