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
 * already done — a skill with no destination fails its own attempt, because
 * there is nowhere to send it. The failure is scoped to the row rather than the
 * run: a queue holding skills for several submitters is normal, and one of them
 * going away must not stall the others.
 *
 * The address is per project, from the `callbackUrl` / `callbackSecret` the
 * submitting caller sent to `POST /api/v1/projects`, so it is read off the
 * joined project row rather than from the environment.
 */

import { listSkillsNeedingPushJoined } from "@/lib/github/service/skill"
import { pushSkill } from "@/lib/github/service/push-skill"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"
import { sendWebhook } from "@/lib/webhook/client"
import type { WebhookSender } from "@/lib/tasks/tasks/build-daily-data"

export interface PushSkillsOptions {
  sender?: WebhookSender
  /** 覆盖 project 行上的地址，测试用。 */
  destination?: { url: string; secret: string }
  now?: () => Date
}

export function createPushSkillsTask(options: PushSkillsOptions = {}): Task {
  return {
    name: "push-skills",
    description:
      "Push every stored skill that has never been pushed, or whose last " +
      "push failed, to its project's skills destination",

    async run({ db, logger }) {
      const pending = await listSkillsNeedingPushJoined(db)
      if (pending.length === 0) {
        logger.info("no skills need pushing")
        return { processed: 0, pushed: 0, failed: 0, pending: 0 }
      }

      const sender = options.sender ?? sendWebhook
      const now = options.now ?? (() => new Date())

      const results = await processItems(
        pending,
        async ({ skill, project, repo }) => {
          // A destination with no secret is treated as no destination: pushing
          // unsigned would hand anyone who guessed the URL the ability to inject
          // skills, which is worse than leaving the row queued for a retry.
          const destination =
            options.destination ??
            (project.skillsWebhookUrl && project.skillsWebhookSecret
              ? {
                  url: project.skillsWebhookUrl,
                  secret: project.skillsWebhookSecret,
                }
              : null)

          const fullName = `${repo.owner}/${repo.name}`
          if (!destination) {
            return {
              meta: { processed: 1, pushed: 0 },
              data: {
                slug: project.slug,
                full_name: fullName,
                skill_dir: skill.skillDir,
                pushed: false,
                skipped: true,
                reason: "no_destination",
              },
            }
          }

          // The same call the console's per-skill retry makes, so a manual
          // push and the scheduled one cannot diverge in payload or bookkeeping.
          const result = await pushSkill(
            db,
            { projectId: skill.projectId, skillDir: skill.skillDir },
            { webhookUrl: destination.url, secret: destination.secret, sender, now }
          )

          if (result.pushed) {
            logger.info(
              `pushed ${result.fullName} (${result.skillDir}): ${result.summary}`
            )
          } else {
            logger.error(
              `failed ${result.fullName} (${result.skillDir}): ` +
                `recorded for retry — ${result.summary}`
            )
          }

          return {
            meta: { processed: 1, pushed: result.pushed ? 1 : 0 },
            data: {
              slug: result.slug,
              full_name: result.fullName,
              skill_dir: result.skillDir,
              pushed: result.pushed,
              skipped: false,
              reason: result.summary,
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
