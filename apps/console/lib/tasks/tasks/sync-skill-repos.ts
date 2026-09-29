/**
 * Fetches, translates and stores every skill project's SKILL.md documents.
 *
 * Translation is folded back in here when an AI provider is configured:
 * without one the parse-and-store half stands alone, and the push is still a
 * separate task reading {@link listSkillsNeedingPush}, so a run here cannot
 * depend on a downstream service being reachable.
 *
 * The per-project pipeline lives in `@/lib/github/sync-skills` because a
 * single project is also synced on its own — on create, and on request from
 * the dashboard — and that must not mean syncing all of them.
 */

import { createChatModel } from "@/lib/ai/provider"
import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import { syncSkillsForProject } from "@/lib/github/sync-skills"
import { listSkillProjects } from "@/lib/github/service/skill"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"

const SKILL_THROTTLE_MS = 200

export function createSyncSkillReposTask(
  client: GitHubClient = createGitHubClient()
): Task {
  return {
    name: "sync-skill-repos",
    description:
      "Fetch SKILL.md from every skill project, in file or directory mode, " +
      "translate what changed, and replace the stored skills",

    async run({ db, logger }) {
      const projects = await listSkillProjects(db)
      logger.info(`syncing ${projects.length} skill project(s)`)

      // One model for the whole run rather than one per project, so a long
      // sweep does not build a client per iteration.
      const chatModel = createChatModel()

      const result = await processItems(
        projects,
        async (target) => {
          const { skills, translated, empty } = await syncSkillsForProject(
            db,
            client,
            target,
            { logger, chatModel }
          )

          if (empty) return { meta: { empty: 1 }, data: null }

          logger.info(
            `synced ${target.repo.owner}/${target.repo.name}: ${skills} skill(s)`
          )

          return {
            meta: {
              synced: 1,
              skills,
              translated,
            },
            data: null,
          }
        },
        {
          logger,
          label: "skill project",
          concurrency: 3,
          throttleIntervalMs: SKILL_THROTTLE_MS,
        }
      )

      return {
        projects: projects.length,
        synced: result.meta.synced ?? 0,
        skills: result.meta.skills ?? 0,
        translated: result.meta.translated ?? 0,
        empty: result.meta.empty ?? 0,
        errors: result.meta.error ?? 0,
      }
    },
  }
}
