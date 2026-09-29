/**
 * Pushing one skill to the web service.
 *
 * Extracted from the `push-skills` task so the console's "push now" button and
 * the scheduled retry queue run the same code. A second implementation of the
 * payload build would drift, and the drift would only show up as a skill the
 * task pushes successfully that the operator's manual retry could not.
 *
 * The push is a single webhook call, so unlike a project resync it does not
 * outlive the request: the operator is waiting on the result.
 */

import { and, eq } from "drizzle-orm"
import { projectSkills, projects, repos } from "@/db/schema"
import { recordPushFailure, recordPushSuccess } from "@/lib/github/service/skill"
import type { Db } from "@/lib/github/service/repo"
import { buildSkillWebhookPayload } from "@/lib/webhook/skill-webhook"
import { hasAccepted, sendWebhook, summarise } from "@/lib/webhook/client"
import type { WebhookSender } from "@/lib/tasks/tasks/build-daily-data"

export interface PushSkillDeps {
  webhookUrl: string
  secret?: string
  token?: string
  sender?: WebhookSender
  now?: () => Date
}

export interface PushSkillResult {
  slug: string
  fullName: string
  skillDir: string
  pushed: boolean
  /** The delivery outcome, kept so a failure can be shown next to the row. */
  summary: string
}

/**
 * Sends one skill and records the outcome on its row.
 *
 * Returns the outcome rather than throwing on a rejected delivery: a refused
 * webhook is a fact about the row, not an exception, and the caller shows it
 * beside the skill the same way the task does. A missing skill or an
 * unresolvable repository does throw, because there is no row to record on.
 */
export async function pushSkill(
  db: Db,
  input: { projectId: string; skillDir: string },
  deps: PushSkillDeps
): Promise<PushSkillResult> {
  const [row] = await db
    .select({ skill: projectSkills, project: projects, repo: repos })
    .from(projectSkills)
    .innerJoin(projects, eq(projectSkills.projectId, projects.id))
    .innerJoin(repos, eq(projects.repoId, repos.id))
    .where(
      and(
        eq(projectSkills.projectId, input.projectId),
        eq(projectSkills.skillDir, input.skillDir)
      )
    )
    .limit(1)
  if (!row) {
    throw new Error(
      `Skill not found: ${input.projectId}/${input.skillDir}`
    )
  }

  const { skill, project, repo } = row
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

  const sender = deps.sender ?? sendWebhook
  const at = (deps.now ?? (() => new Date()))()
  const sent = await sender(
    [deps.webhookUrl],
    payload,
    { secret: deps.secret, token: deps.token }
  )
  const accepted = hasAccepted(sent)
  const summary = summarise(sent)

  if (accepted) {
    await recordPushSuccess(db, skill.projectId, skill.skillDir, at)
  } else {
    await recordPushFailure(db, skill.projectId, skill.skillDir, summary, at)
  }

  return {
    slug: project.slug,
    fullName: `${repo.owner}/${repo.name}`,
    skillDir: skill.skillDir,
    pushed: accepted,
    summary,
  }
}
