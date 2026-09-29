/**
 * Integration tests for the skills push task.
 *
 * The task is the delivery half of the skills pipeline, so its tests follow
 * one document through the retry queue: never pushed → sent → recorded, or
 * failed → error kept → retried on the next run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db, pool } from "@/db/client"
import { projects, repos } from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  getSkill,
  recordPushSuccess,
  syncProjectSkills,
} from "@/lib/github/service/skill"
import {
  createPushSkillsTask,
  type PushSkillsOptions,
} from "@/lib/tasks/tasks/push-skills"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import { resetSyncEnvCache } from "@/lib/env"
import type { SendOptions, WebhookResult } from "@/lib/webhook/client"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

const okUrl = "https://skills.example/hook"

let slugSuffix = 0

async function seedProject(owner: string, name: string) {
  const repo = await upsertRepo(db, repoInfo(owner, name))
  slugSuffix += 1
  const project = await createProject(db, {
    repoId: repo.id,
    name,
    owner,
    slug: `pusher-${owner}-${name}-${slugSuffix}`,
    type: "skill",
  })
  return { repo, project }
}

function repoInfo(owner: string, name: string): RepoInfo {
  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 7,
    description: "",
    homepage: "",
    createdAt: new Date("2023-01-01T00:00:00Z"),
    pushedAt: new Date("2024-01-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 10,
    topics: [],
    archived: false,
    commitCount: 3,
    lastCommit: new Date("2024-01-01T00:00:00Z"),
    mentionableUsersCount: 1,
    watchersCount: 1,
    licenseSpdxId: "MIT",
    pullRequestsCount: 1,
    releasesCount: 1,
    languages: [],
    forks: 1,
    openGraphImageUrl: "",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "",
    latestReleaseTagName: "",
    latestReleasePublishedAt: undefined,
    latestReleaseUrl: "",
    latestReleaseDescription: "",
  }
}

async function seedSkill(
  repoOwner: string,
  repoName: string,
  skillDir: string
) {
  const { repo, project } = await seedProject(repoOwner, repoName)
  await syncProjectSkills(db, project.id, [
    {
      projectId: project.id,
      skillDir,
      name: skillDir,
      description: `Work with ${skillDir}`,
      descriptionZh: "",
      readme: `Body of ${skillDir}`,
      readmeZh: "",
      version: "1.0.0",
    },
  ])
  return { repo, project }
}

interface RecordedCall {
  urls: string[]
  payload: unknown
  options?: SendOptions
}

/** A sender that records every call, succeeding (or mapping) per `behavior`. */
function recordingSender(behavior?: () => WebhookResult[]) {
  const calls: RecordedCall[] = []
  const sender = vi.fn(
    async (
      urls: string[],
      payload: unknown,
      options?: SendOptions
    ): Promise<WebhookResult[]> => {
      calls.push({ urls, payload, options })
      return behavior
        ? behavior()
        : urls.map((url) => ({ url, success: true, status: 200 }))
    }
  )
  return { calls, sender }
}

function task(options: PushSkillsOptions) {
  return createPushSkillsTask(options)
}

describe.skipIf(!hasDatabase)("push-skills (integration)", () => {
  beforeAll(async () => {
    await db.delete(projects)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  it("pushes a skill that has never been pushed and marks it synced", async () => {
    const { repo, project } = await seedSkill("acme", "skills", "pdf")
    const { calls, sender } = recordingSender()
    const now = new Date("2026-03-01T03:00:00Z")

    const outcome = await task({
      webhookUrl: okUrl,
      token: "skills-token",
      secret: "shared-secret",
      sender,
      now: () => now,
    }).run({ db, logger: console } as never)

    expect(calls).toHaveLength(1)
    const { urls, payload, options } = calls[0]!
    expect(urls).toEqual([okUrl])
    expect(options).toMatchObject({
      token: "skills-token",
      secret: "shared-secret",
    })
    expect(payload).toMatchObject({
      event_type: "skill_updated",
      data: {
        repo_full_name: `${repo.owner}/${repo.name}`,
        repo_owner: repo.owner,
        repo_name: repo.name,
        skill_dir: "pdf",
        name: "pdf",
        description: "Work with pdf",
        version: "1.0.0",
        category_id: null,
      },
    })

    expect(outcome).toMatchObject({ processed: 1, pushed: 1, failed: 0 })

    const stored = await getSkill(db, project.id, "pdf")
    expect(stored?.syncedToWebAt?.toISOString()).toBe(
      "2026-03-01T03:00:00.000Z"
    )
    expect(stored?.lastSyncError).toBeNull()
  })

  it("does not send a skill that was already pushed", async () => {
    const { project } = await seedSkill("acme", "already", "typed")
    await recordPushSuccess(
      db,
      project.id,
      "typed",
      new Date("2026-03-01T02:00:00Z")
    )

    const { calls, sender } = recordingSender()
    const outcome = await task({ webhookUrl: okUrl, sender }).run({
      db,
      logger: console,
    } as never)

    expect(calls).toHaveLength(0)
    expect(outcome).toMatchObject({ processed: 0, pushed: 0 })
  })

  it("records a failed push for retry and clears it on the next run", async () => {
    const { project } = await seedSkill("acme", "flaky", "cli")
    let failures = 1
    const { sender } = recordingSender(() => {
      if (failures > 0) {
        failures -= 1
        return [
          {
            url: okUrl,
            success: false,
            status: 500,
            error: "500 Internal Server Error",
          },
        ]
      }
      return [{ url: okUrl, success: true, status: 200 }]
    })

    const first = await task({ webhookUrl: okUrl, sender }).run({
      db,
      logger: console,
    } as never)
    expect(first).toMatchObject({ pushed: 0, failed: 1 })

    const stored = await getSkill(db, project.id, "cli")
    expect(stored?.syncedToWebAt).toBeNull()
    expect(stored?.lastSyncError).toContain("500")
    expect(stored?.lastSyncAttemptAt).not.toBeNull()

    const second = await task({ webhookUrl: okUrl, sender }).run({
      db,
      logger: console,
    } as never)
    expect(second).toMatchObject({ pushed: 1, failed: 0 })

    const retried = await getSkill(db, project.id, "cli")
    expect(retried?.syncedToWebAt).not.toBeNull()
    expect(retried?.lastSyncError).toBeNull()
  })

  it("skips cleanly when nothing is pending", async () => {
    // Every skill seeded so far in this suite was pushed, so the retry queue
    // is empty and the run has nothing to do — and must not require a webhook
    // URL to discover that.
    const { calls, sender } = recordingSender()
    const outcome = await task({ sender }).run({ db, logger: console } as never)
    expect(calls).toHaveLength(0)
    expect(outcome).toMatchObject({ processed: 0, pushed: 0, pending: 0 })
  })

  it("fails the run when the webhook URL is missing and work is pending", async () => {
    await seedSkill("acme", "stranded", "gen")

    const previous = process.env.SKILLS_WEBHOOK_URL
    delete process.env.SKILLS_WEBHOOK_URL
    resetSyncEnvCache()
    try {
      await task({}).run({ db, logger: console } as never)
      expect.unreachable("task should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe(
        'No "SKILLS_WEBHOOK_URL" env. variable!'
      )
    } finally {
      if (previous !== undefined) process.env.SKILLS_WEBHOOK_URL = previous
      resetSyncEnvCache()
    }
  })
})
