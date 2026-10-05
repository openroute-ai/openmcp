/**
 * Integration tests for the notification and delivery tasks.
 *
 * These tasks dispatch to external webhooks, so every test injects a sender
 * that records the calls instead of reaching out. What is asserted is the
 * *decision* logic: which repos are dispatched, which period a notification
 * covers, and what the payload looks like when it leaves the task.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { db, pool } from "@/db/client"
import {
  projects,
  projectsToTags,
  repoMonthlyStats,
  repoWeeklyStats,
  repos,
} from "@/db/schema"
import { fakeContext } from "@/test/helpers/fakes"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  lastCompletePeriod,
  periodFromMonth,
  periodFromWeek,
} from "@/lib/github/snapshot-dates"
import { upsertStatsRow } from "@/lib/github/service/stats"

import type { RepoInfo } from "@/lib/github/repo-info-query"
import type { WebhookResult } from "@/lib/webhook/client"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let nextId = 0

function info(overrides: Partial<RepoInfo> = {}): RepoInfo {
  const n = (nextId += 1)
  const owner = `owner${n}`
  const name = `repo${n}`

  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 1000 + n,
    description: "The repository description",
    homepage: "https://example.com",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    pushedAt: new Date("2026-06-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 100,
    topics: [],
    archived: false,
    commitCount: 10,
    lastCommit: new Date("2026-06-01T00:00:00Z"),
    mentionableUsersCount: 1,
    watchersCount: 1,
    licenseSpdxId: "MIT",
    pullRequestsCount: 1,
    openIssuesCount: 1,
    releasesCount: 1,
    languages: ["TypeScript"],
    forks: 1,
    openGraphImageUrl: "",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "",
    latestReleaseTagName: "",
    latestReleasePublishedAt: undefined,
    latestReleaseUrl: "",
    latestReleaseDescription: "",
    ...overrides,
  }
}

async function seed(overrides: { status?: string; type?: string } = {}) {
  const n = (nextId += 1)
  const repo = await upsertRepo(db, info())
  const project = await createProject(db, {
    repoId: repo.id,
    name: `Project ${n}`,
    owner: repo.owner,
    slug: `slug-${n}`,
    description: "The project description",
    url: "https://example.com",
    status: (overrides.status as "active") ?? "active",
    type: (overrides.type as "application") ?? "application",
  })
  return { repo, project, fullName: `${repo.owner}/${repo.name}` }
}

/** A sender that records calls and reports one accepted endpoint. */
function recordingSender() {
  const calls: {
    urls: string[]
    payload: unknown
    options?: { secret?: string; token?: string }
  }[] = []
  const sender = vi.fn(
    async (
      urls: string[],
      payload: unknown,
      options?: { secret?: string; token?: string }
    ): Promise<WebhookResult[]> => {
      calls.push({ urls, payload, options })
      return urls.map((url) => ({ url, success: true, status: 200 }))
    }
  )
  return { calls, sender }
}

/** A `now` that always names the last complete week as a known one. */
function weekTarget() {
  const now = new Date("2026-03-10T02:00:00Z")
  return { now, target: lastCompletePeriod("week", now) }
}

/**
 * One weekly row: the level the week closed at, and its change.
 *
 * The previous week's row carries a level with no change, which is what a
 * repository that was already being measured looks like — the ranking needs it
 * to know there is a count to divide by.
 */
async function seedWeek(
  repoId: string,
  yearWeek: { year: number; week: number },
  columns: { totalStars: number; deltaStars?: number }
) {
  await upsertStatsRow(db, "week", repoId, periodFromWeek(yearWeek), {
    levels: { stars: columns.totalStars },
    ...(columns.deltaStars === undefined
      ? {}
      : { changes: { stars: columns.deltaStars } }),
  })
}

/** One monthly row, in the same shape. */
async function seedMonth(
  repoId: string,
  yearMonth: { year: number; month: number },
  columns: { totalStars: number; deltaStars?: number }
) {
  await upsertStatsRow(db, "month", repoId, periodFromMonth(yearMonth), {
    levels: { stars: columns.totalStars },
    ...(columns.deltaStars === undefined
      ? {}
      : { changes: { stars: columns.deltaStars } }),
  })
}

describe.skipIf(!hasDatabase)("notification tasks (integration)", () => {
  beforeAll(async () => {
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
    await db.delete(projects)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("build-daily-data", () => {
    let imp: typeof import("@/lib/tasks/tasks/build-daily-data")

    beforeAll(async () => {
      imp = await import("@/lib/tasks/tasks/build-daily-data")
    })

    it("dispatches one callback per non-deprecated repository", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createBuildDailyDataTask({
        sender: sender as never,
        endpoints: ["https://peer.example/hook"],
        secret: "s3cret",
      })

      await seed()
      await seed({ status: "deprecated" })

      const result = await task.run(fakeContext(db))

      expect(result).toMatchObject({ processed: 1, pushed: 1, failed: 0 })
      expect(calls).toHaveLength(1)
      expect(calls[0]!.urls).toEqual(["https://peer.example/hook"])
      expect(calls[0]!.options).toMatchObject({
        secret: "s3cret",
        token: undefined,
      })
    })

    it("builds the repo_updated payload the peers expect", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createBuildDailyDataTask({
        sender: sender as never,
        endpoints: ["https://peer.example/hook"],
      })

      const { repo, project } = await seed()

      await task.run(fakeContext(db))

      const payload = calls[0]!.payload as {
        event_type: string
        data: {
          full_name: string
          type: string
          meta: { success: boolean; task_name: string }
        }
      }
      expect(payload.event_type).toBe("repo_updated")
      expect(payload.data.full_name).toBe(`${repo.owner}/${repo.name}`)
      expect(payload.data.type).toBe(project.type)
      expect(payload.data.meta).toMatchObject({
        success: true,
        task_name: "update-github-data",
      })
    })

    it("sends nothing when no endpoints are configured", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createBuildDailyDataTask({
        sender: sender as never,
        endpoints: [],
      })

      await seed()

      const result = await task.run(fakeContext(db))

      expect(result).toMatchObject({ processed: 0, endpoints: 0 })
      expect(calls).toHaveLength(0)
    })
  })

  describe("notify-daily", () => {
    let imp: typeof import("@/lib/tasks/tasks/notify-daily")

    beforeAll(async () => {
      imp = await import("@/lib/tasks/tasks/notify-daily")
    })

    async function seedAWeek() {
      const { target } = weekTarget()
      const previous = { year: target.year, week: target.week - 1 }
      const { repo } = await seed()
      await seedWeek(repo.id, previous, { totalStars: 100 })
      await seedWeek(repo.id, target, { totalStars: 130, deltaStars: 30 })
      return { repo, target }
    }

    it("sends the top projects of the last complete week as WeCom news", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createNotifyDailyTask({
        sender: sender as never,
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k",
        now: () => new Date("2026-03-10T02:00:00Z"),
      })

      await seedAWeek()
      await task.run(fakeContext(db))

      expect(calls).toHaveLength(1)
      const payload = calls[0]!.payload as {
        msgtype: string
        news: { articles: { title: string; url: string; picurl: string }[] }
      }
      expect(payload.msgtype).toBe("news")
      expect(payload.news.articles).toHaveLength(1)
      const article = payload.news.articles[0]!
      expect(article.title).toBeTruthy()
      expect(article.url).toMatch(/^https:\/\/github\.com\//)
      expect(article.picurl).toMatch(/avatars\.githubusercontent\.com/)
    })

    it("reports not sent when WEWORK_WEBHOOK_URL is missing", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createNotifyDailyTask({
        sender: sender as never,
        webhookUrl: undefined,
        now: () => new Date("2026-03-10T02:00:00Z"),
      })

      await seedAWeek()

      const result = await task.run(fakeContext(db))

      expect(result).toMatchObject({ sent: false })
      expect(calls).toHaveLength(0)
    })

    it("silently reports no trending data instead of notifying on nothing", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createNotifyDailyTask({
        sender: sender as never,
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k",
        now: () => new Date("2026-03-10T02:00:00Z"),
      })

      await seed()

      const result = await task.run(fakeContext(db))

      expect(result).toMatchObject({ sent: false })
      expect(calls).toHaveLength(0)
    })
  })

  describe("trigger-weekly-finished", () => {
    let imp: typeof import("@/lib/tasks/tasks/trigger-ranking-finished")

    beforeAll(async () => {
      imp = await import("@/lib/tasks/tasks/trigger-ranking-finished")
    })

    it("sends the top projects with rank and delta", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createTriggerRankingsFinishedTask("week", {
        sender: sender as never,
        webhookUrl: "https://consumer.example/weekly",
        secret: "s3cret",
        token: "t0ken",
        now: () => new Date("2026-03-10T02:00:00Z"),
      })

      const { target } = weekTarget()
      const previous = { year: target.year, week: target.week - 1 }
      const { repo, project } = await seed()
      await seedWeek(repo.id, previous, { totalStars: 100 })
      await seedWeek(repo.id, target, { totalStars: 130, deltaStars: 30 })

      const result = await task.run(fakeContext(db))

      const payload = calls[0]!.payload as {
        year: number
        week: number
        projects: { rank: number; full_name: string; delta: number }[]
        total_projects: number
      }
      expect(payload.year).toBe(target.year)
      expect(payload.week).toBe(target.week)
      expect(payload.total_projects).toBe(1)
      expect(payload.projects[0]).toMatchObject({
        rank: 1,
        full_name: `${repo.owner}/${repo.name}`,
        delta: 30,
      })
      expect(result).toMatchObject({
        sent: true,
        webhookSuccessful: 1,
        webhookFailed: 0,
      })
      // The secret and token must reach the sender; they are what the webhook
      // client signs with and the legacy receivers check.
      expect(calls[0]!.options).toMatchObject({
        secret: "s3cret",
        token: "t0ken",
      })
      expect(project.status).toBe("active")
    })

    it("fails the run when the webhook URL is not configured", async () => {
      const { sender } = recordingSender()
      const task = imp.createTriggerRankingsFinishedTask("week", {
        sender: sender as never,
        webhookUrl: undefined,
      })

      await seed()

      await expect(task.run(fakeContext(db))).rejects.toThrow(
        /WEEKLY_WEBHOOK_URL/
      )
    })
  })

  describe("trigger-monthly-finished", () => {
    let imp: typeof import("@/lib/tasks/tasks/trigger-ranking-finished")

    beforeAll(async () => {
      imp = await import("@/lib/tasks/tasks/trigger-ranking-finished")
    })

    it("sends the previous month's top projects", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createTriggerRankingsFinishedTask("month", {
        sender: sender as never,
        webhookUrl: "https://consumer.example/monthly",
        secret: "s3cret",
        now: () => new Date("2026-03-10T02:00:00Z"),
      })

      const { repo } = await seed()
      // A Tuesday in March: the last complete month is February.
      await seedMonth(repo.id, { year: 2026, month: 1 }, { totalStars: 100 })
      await seedMonth(repo.id, { year: 2026, month: 2 }, {
        totalStars: 130,
        deltaStars: 30,
      })

      const result = await task.run(fakeContext(db))

      const payload = calls[0]!.payload as {
        year: number
        month: number
        projects: { full_name: string; delta: number }[]
      }
      expect(payload.month).toBe(2)
      expect(payload.projects[0]).toMatchObject({
        full_name: `${repo.owner}/${repo.name}`,
        delta: 30,
      })
      expect(result).toMatchObject({ sent: true, month: 2, year: 2026 })
    })

    it("sends nothing when the month has no data", async () => {
      const { sender, calls } = recordingSender()
      const task = imp.createTriggerRankingsFinishedTask("month", {
        sender: sender as never,
        webhookUrl: "https://consumer.example/monthly",
        now: () => new Date("2026-03-10T02:00:00Z"),
      })

      await seed()

      const result = await task.run(fakeContext(db))

      expect(result).toMatchObject({ sent: false })
      expect(calls).toHaveLength(0)
    })
  })
})
