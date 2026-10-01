/**
 * Integration tests for the admin dashboard routers: overview, tasks,
 * projects, skills and sync.
 *
 * The services these wrap are covered deeply elsewhere. What these tests
 * protect is the dashboard wiring: the reads return the seeded data with the
 * right shape, the filters isolate the right rows, an enable/disable
 * round-trips, and a manual run goes through the real runner.
 */

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createCaller } from "@/lib/trpc/root"
import { fakeAdminContext } from "./helpers/fakes"
import { db, pool } from "@/db/client"
import {
  projectSkills,
  projects,
  projectSyncJobs,
  readmeSyncJobs,
  repoWeeklyStats,
  repos,
  
  tags,
  projectsToTags,
  hallOfFame,
  hallOfFameToProjects,
  taskDefinitions,
  taskExecutions,
  taskStatus,
} from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { seedDefinitions } from "@/lib/tasks/seed"
import { resetSyncEnvCache } from "@/lib/env"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import { TRPCError } from "@trpc/server"
import { ERROR_CODES, SKIP_CODES } from "@/lib/trpc/error-codes"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let nextId = 0

function info(): RepoInfo {
  const n = (nextId += 1)
  const owner = `owner${n}`
  const name = `repo${n}`

  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 3000 + n,
    description: "The repository description",
    homepage: "",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    pushedAt: new Date("2026-06-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 1000 + n,
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
    forks: 3,
    openGraphImageUrl: "",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "",
    latestReleaseTagName: "",
    latestReleasePublishedAt: undefined,
    latestReleaseUrl: "",
    latestReleaseDescription: "",
  }
}

async function seedProject(overrides: Partial<Parameters<typeof createProject>[1]> = {}) {
  const repo = await upsertRepo(db, info())
  const project = await createProject(db, {
    repoId: repo.id,
    name: `Project ${nextId}`,
    owner: repo.owner,
    slug: `slug-${nextId}`,
    description: "The project description",
    status: "active",
    type: "skill",
    ...overrides,
  })
  return { repo, project }
}

async function taskId(name: string): Promise<string> {
  const [row] = await db
    .select({ id: taskDefinitions.id })
    .from(taskDefinitions)
    .where(eq(taskDefinitions.name, name))
  if (!row) throw new Error(`task definition ${name} was not seeded`)
  return row.id
}

async function clean() {
  await db.delete(projectSyncJobs)
  await db.delete(readmeSyncJobs)
  await db.delete(projectSkills)
  await db.delete(projectsToTags)
  await db.delete(hallOfFameToProjects)
  await db.delete(hallOfFame)
  await db.delete(repoWeeklyStats)

  await db.delete(tags)
  await db.delete(projects)
  await db.delete(repos)
  await db.delete(taskExecutions)
  await db.delete(taskStatus)
  await db.delete(taskDefinitions)
}

describe.skipIf(!hasDatabase)("admin webui (integration)", () => {
  // Every procedure in this router is `adminProcedure`, so the caller has to be
  // an admin for the suite to reach anything. `admin-auth` covers the refusal.
  const caller = createCaller(fakeAdminContext(db))

  beforeAll(async () => {
    process.env.GITHUB_ACCESS_TOKEN =
      process.env.GITHUB_ACCESS_TOKEN ?? "test-token"
    resetSyncEnvCache()
    await clean()
    await seedDefinitions()
  })

  beforeEach(async () => {
    await clean()
    await seedDefinitions()
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("overview", () => {
    it("counts repositories, projects and skills", async () => {
      const { project } = await seedProject()
      await db.insert(projectSkills).values([
        {
          id: `skill-pending-${project.id}`,
          projectId: project.id,
          skillDir: "pending",
          name: "Pending skill",
          description: "d",
          readme: "r",
        },
        {
          id: `skill-synced-${project.id}`,
          projectId: project.id,
          skillDir: "synced",
          name: "Synced skill",
          description: "d",
          descriptionZh: "描述",
          readme: "r",
          readmeZh: "读我",
          syncedToWebAt: new Date(),
        },
        {
          id: `skill-failed-${project.id}`,
          projectId: project.id,
          skillDir: "failed",
          name: "Failed skill",
          description: "d",
          readme: "r",
          lastSyncError: "push failed",
        },
      ])

      const snapshot = await caller.overview.snapshot()

      expect(snapshot.repos).toBe(1)
      expect(snapshot.projects).toBe(1)
      expect(snapshot.skills.total).toBe(3)
      expect(snapshot.skills.synced).toBe(1)
      expect(snapshot.skills.pending).toBe(1)
      expect(snapshot.skills.failed).toBe(1)
      expect(snapshot.tasks.enabled).toBeGreaterThan(0)
    })

    it("lists the six most recently added projects, newest first", async () => {
      // `createdAt` is what the overview orders by, and it would otherwise
      // default to one transaction timestamp for all eight rows, leaving the
      // order to PostgreSQL. Staggered dates make the assertion about the
      // ordering rather than about the insertion order.
      for (let index = 0; index < 8; index += 1) {
        const { project } = await seedProject({ name: `recent-${index}` })
        await db
          .update(projects)
          .set({
            createdAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
          })
          .where(eq(projects.id, project.id))
      }

      const snapshot = await caller.overview.snapshot()

      // Six, not eight: the overview is a glance, and the pager on the list is
      // where the rest are reached from.
      expect(snapshot.recentProjects).toHaveLength(6)
      expect(snapshot.recentProjects[0]?.name).toBe("recent-7")
      expect(snapshot.recentProjects[5]?.name).toBe("recent-2")
      // Carried so the card can show the owner's mark rather than initials.
      expect(snapshot.recentProjects[0]?.ownerId).toBeGreaterThan(0)
      expect(snapshot.recentProjects[0]?.stars).toBeGreaterThan(0)
    })

    it("lists the most recent task executions first", async () => {
      const definitionId = await taskId("build-weekly-rankings")
      // `createdAt` is what the overview orders by, and it defaults to `now()`
      // for the whole statement, so both rows would tie and PostgreSQL would
      // break the tie by physical tuple position. That depends on how much
      // earlier runs left the table, which made this assertion pass or fail
      // depending on the state of the database rather than on the ordering.
      await db.insert(taskExecutions).values([
        {
          id: "exec-a",
          taskDefinitionId: definitionId,
          status: "completed",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "exec-b",
          taskDefinitionId: definitionId,
          status: "failed",
          startedAt: new Date("2026-01-02T00:00:00Z"),
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
      ])

      const snapshot = await caller.overview.snapshot()

      expect(snapshot.recentExecutions[0]?.id).toBe("exec-b")
      expect(snapshot.recentExecutions[1]?.id).toBe("exec-a")
    })
  })

  describe("tasks", () => {
    it("lists every seeded definition", async () => {
      const tasks = await caller.tasks.list()
      expect(tasks.length).toBeGreaterThan(0)
      expect(tasks.map((task) => task.name)).toContain("build-weekly-rankings")
    })

    it("toggles a task's enabled flag", async () => {
      await caller.tasks.setEnabled({
        name: "build-weekly-rankings",
        enabled: false,
      })
      let tasks = await caller.tasks.list()
      expect(
        tasks.find((t) => t.name === "build-weekly-rankings")?.isEnabled
      ).toBe(false)

      await caller.tasks.setEnabled({
        name: "build-weekly-rankings",
        enabled: true,
      })
      tasks = await caller.tasks.list()
      expect(
        tasks.find((t) => t.name === "build-weekly-rankings")?.isEnabled
      ).toBe(true)
    })

    it("attaches the latest execution to each task", async () => {
      const definitionId = await taskId("build-weekly-rankings")
      await db.insert(taskExecutions).values([
        {
          id: "old-exec",
          taskDefinitionId: definitionId,
          status: "completed",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "new-exec",
          taskDefinitionId: definitionId,
          status: "failed",
          startedAt: new Date("2026-01-03T00:00:00Z"),
          createdAt: new Date("2026-01-03T00:00:00Z"),
        },
      ])

      const task = (await caller.tasks.list()).find(
        (t) => t.name === "build-weekly-rankings"
      )
      expect(task?.lastExecution?.id).toBe("new-exec")
    })

    it("reports when each task next runs", async () => {
      // The schedule says when work is *due*; the column says when it will
      // actually happen, which is the wake-up at or after the due moment.
      const tasks = await caller.tasks.list()
      for (const task of tasks) {
        expect(task.nextRunAt, task.name).toBeInstanceOf(Date)
        expect(task.nextRunAt!.getTime(), task.name).toBeGreaterThan(
          Date.now() - 60_000
        )
      }
    })

    it("reports no next run for a task that is turned off", async () => {
      await caller.tasks.setEnabled({
        name: "build-weekly-rankings",
        enabled: false,
      })

      const task = (await caller.tasks.list()).find(
        (t) => t.name === "build-weekly-rankings"
      )
      // Nothing will run it, so putting a time on it would be a promise the
      // scheduler is not keeping.
      expect(task?.nextRunAt).toBeNull()
    })

    it("rejects an unknown task", async () => {
      // Both the readable message and the code: the message reaches a server
      // log, the code is what the interface puts in the reader's language.
      const error = await caller.tasks
        .runNow({ name: "no-such-task" })
        .catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(TRPCError)
      expect((error as TRPCError).message).toMatch(/unknown task/)
      // tRPC wraps a cause that is not an `Error` in an `UnknownCauseError`
      // and copies its properties across, so the code is read off it rather
      // than the object being compared whole.
      expect((error as TRPCError).cause).toMatchObject({
        code: ERROR_CODES.taskNotFound,
      })
    })

    it("skips a disabled task", async () => {
      await caller.tasks.setEnabled({
        name: "build-weekly-rankings",
        enabled: false,
      })
      const result = await caller.tasks.runNow({
        name: "build-weekly-rankings",
      })
      expect(result.status).toBe("skipped")
      if (result.status === "skipped") {
        expect(result.reasonCode).toBe(SKIP_CODES.taskDisabled)
      }
    })

    it("runs a task on demand", async () => {
      const result = await caller.tasks.runNow({
        name: "build-weekly-rankings",
      })
      expect(result.status).toBe("completed")

      const task = (await caller.tasks.list()).find(
        (t) => t.name === "build-weekly-rankings"
      )
      expect(task?.lastExecution?.triggeredBy).toBe("manual")
    })
  })

  describe("projects", () => {
    it("joins the repository and the last sync job", async () => {
      const { repo, project } = await seedProject()
      await db.insert(projectSkills).values({
        id: `skill-${project.id}`,
        projectId: project.id,
        skillDir: "a",
        name: "Skill A",
        description: "d",
        readme: "r",
      })
      await db.insert(projectSyncJobs).values([
        {
          id: "job-old",
          projectId: project.id,
          repoId: repo.id,
          status: "failed",
          triggeredBy: "system",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "job-new",
          projectId: project.id,
          repoId: repo.id,
          status: "success",
          triggeredBy: "system",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
      ])

      const result = await caller.projects.list({})

      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.id).toBe(project.id)
      expect(result.items[0]?.stars).toBe(repo.stars)
      expect(result.items[0]?.skillCount).toBe(1)
      expect(result.items[0]?.lastSync?.status).toBe("success")
      expect(result.items[0]?.lastSync?.id).toBe("job-new")
    })

    it("returns the owner id so a row can show the author's avatar", async () => {
      const { repo, project } = await seedProject()

      const row = (await caller.projects.list({})).items[0]
      // Without this the logo column falls back to initials for every project
      // whose repository icon has not been mirrored yet.
      expect(row?.ownerId).toBe(repo.ownerId)
      expect(row?.id).toBe(project.id)
    })

    it("pages, searches and counts with the same filter", async () => {
      await seedProject({ name: "alpha", owner: "acme" })
      await seedProject({ name: "beta", owner: "acme" })
      await seedProject({ name: "gamma", owner: "other" })

      const firstPage = await caller.projects.list({ limit: 2, offset: 0 })
      expect(firstPage.items).toHaveLength(2)
      // The count is the whole filtered set, not the page, or the pager would
      // offer a second page that does not exist.
      expect(firstPage.total).toBe(3)

      const secondPage = await caller.projects.list({ limit: 2, offset: 2 })
      expect(secondPage.items).toHaveLength(1)
      expect(secondPage.total).toBe(3)

      const found = await caller.projects.list({ search: "other" })
      expect(found.total).toBe(1)
      expect(found.items[0]?.name).toBe("gamma")

      // A LIKE wildcard is a literal, not a match-everything switch.
      const wildcard = await caller.projects.list({ search: "%" })
      expect(wildcard.total).toBe(0)

      const none = await caller.projects.list({ search: "nothing-here" })
      expect(none.total).toBe(0)
      expect(none.items).toHaveLength(0)
    })

    it("returns the repository icon for the list's logo column", async () => {
      const { repo, project } = await seedProject()
      await db
        .update(repos)
        .set({ iconUrl: "https://example.test/icon.png" })
        .where(eq(repos.id, repo.id))

      const row = (await caller.projects.list({})).items[0]
      expect(row?.iconUrl).toBe("https://example.test/icon.png")
      // The project's own logo is unset, so the icon is the only mark there is
      // and the two must not be conflated into one column.
      expect(row?.logo).toBeNull()
      expect(row?.id).toBe(project.id)
    })

    it("returns a project with its skills, jobs, authors and tags", async () => {
      const { repo, project } = await seedProject()
      await db
        .update(projects)
        .set({ logo: "https://example.test/logo.png", twitter: "@acme" })
        .where(eq(projects.id, project.id))

      await db.insert(projectSkills).values([
        {
          id: `skill-b-${project.id}`,
          projectId: project.id,
          skillDir: "beta",
          name: "Beta",
          description: "d",
          readme: "r",
        },
        {
          id: `skill-a-${project.id}`,
          projectId: project.id,
          skillDir: "alpha",
          name: "Alpha",
          description: "d",
          readme: "r",
        },
      ])
      await db.insert(projectSyncJobs).values([
        {
          id: "detail-old",
          projectId: project.id,
          repoId: repo.id,
          status: "failed",
          triggeredBy: "system",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "detail-new",
          projectId: project.id,
          repoId: repo.id,
          status: "success",
          triggeredBy: "cron",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
      ])
      await db.insert(hallOfFame).values({
        username: "owner",
        name: "The Owner",
        avatarUrl: "https://example.test/avatar.png",
      })
      await db
        .insert(hallOfFameToProjects)
        .values({ username: "owner", projectId: project.id })
      await db.insert(tags).values({ id: "tag-1", code: "cli", name: "CLI" })
      await db
        .insert(projectsToTags)
        .values({ projectId: project.id, tagId: "tag-1" })

      const detail = await caller.projects.byId({ id: project.id })

      expect(detail.name).toBe(project.name)
      expect(detail.logo).toBe("https://example.test/logo.png")
      expect(detail.twitter).toBe("@acme")
      expect(detail.stars).toBe(repo.stars)
      expect(detail.repoUrl).toBe(
        `https://github.com/${repo.owner}/${repo.name}`
      )

      // Name order, so the list does not shuffle between two renders of the
      // same set.
      expect(detail.skills.map((skill) => skill.name)).toEqual([
        "Alpha",
        "Beta",
      ])
      // Newest first, matching the sync page's own ordering.
      expect(detail.jobs.map((job) => job.id)).toEqual([
        "detail-new",
        "detail-old",
      ])
      expect(detail.authors.map((author) => author.username)).toEqual(["owner"])
      expect(detail.tags.map((tag) => tag.code)).toEqual(["cli"])
    })

    it("answers with NOT_FOUND for a project that is not there", async () => {
      const error = await caller.projects
        .byId({ id: "no-such-project" })
        .catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(TRPCError)
      expect((error as TRPCError).code).toBe("NOT_FOUND")
    })
  })

  describe("skills", () => {
    it("filters by push state", async () => {
      const { project } = await seedProject()
      await db.insert(projectSkills).values([
        {
          id: `skill-pending-${project.id}`,
          projectId: project.id,
          skillDir: "pending",
          name: "Pending skill",
          description: "d",
          readme: "r",
        },
        {
          id: `skill-synced-${project.id}`,
          projectId: project.id,
          skillDir: "synced",
          name: "Synced skill",
          description: "d",
          readme: "r",
          syncedToWebAt: new Date(),
        },
        {
          id: `skill-failed-${project.id}`,
          projectId: project.id,
          skillDir: "failed",
          name: "Failed skill",
          description: "d",
          readme: "r",
          lastSyncError: "push failed",
        },
      ])

      const all = await caller.skills.list({ status: "all" })
      const pending = await caller.skills.list({ status: "pending" })
      const synced = await caller.skills.list({ status: "synced" })
      const errored = await caller.skills.list({ status: "error" })

      expect(all.items).toHaveLength(3)
      expect(all.total).toBe(3)
      expect(pending.items).toHaveLength(1)
      expect(pending.items[0]?.skillDir).toBe("pending")
      expect(synced.items).toHaveLength(1)
      expect(synced.items[0]?.skillDir).toBe("synced")
      expect(errored.items).toHaveLength(1)
      expect(errored.items[0]?.lastSyncError).toBe("push failed")

      // The search runs on the server, and the count it reports is the count of
      // the same filter rather than a second, looser one.
      const byName = await caller.skills.list({ search: "Failed" })
      expect(byName.items).toHaveLength(1)
      expect(byName.items[0]?.skillDir).toBe("failed")
      expect(byName.total).toBe(1)

      // A `%` in the term is a literal, not a wildcard that matches everything.
      const literalWildcard = await caller.skills.list({ search: "%" })
      expect(literalWildcard.total).toBe(0)

      // Paged rather than capped: the rows past the limit are still reachable.
      const firstPage = await caller.skills.list({ limit: 2, offset: 0 })
      expect(firstPage.items).toHaveLength(2)
      expect(firstPage.total).toBe(3)
      const secondPage = await caller.skills.list({ limit: 2, offset: 2 })
      expect(secondPage.items).toHaveLength(1)
    })
  })

  describe("sync", () => {
    it("merges project and readme jobs, newest first", async () => {
      const { repo, project } = await seedProject()
      await db.insert(projectSyncJobs).values({
        id: "job-project",
        projectId: project.id,
        repoId: repo.id,
        status: "success",
        triggeredBy: "system",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })
      await db.insert(readmeSyncJobs).values({
        id: "job-readme",
        repoId: repo.id,
        status: "pending",
        triggeredBy: "system",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })

      const all = await caller.sync.list({})
      expect(all.items).toHaveLength(2)
      expect(all.total).toBe(2)
      expect(all.items[0]?.kind).toBe("readme")
      expect(all.items[0]?.ref).toBe(`${repo.owner}/${repo.name}`)
      expect(all.items[1]?.kind).toBe("project")
      expect(all.items[1]?.ref).toBe(project.name)

      const pending = await caller.sync.list({ status: "pending" })
      expect(pending.items).toHaveLength(1)
      expect(pending.total).toBe(1)
      expect(pending.items[0]?.id).toBe("job-readme")

      // The log is server-paged now, so a second page must be reachable
      // rather than the newest rows being silently dropped past the limit.
      const first = await caller.sync.list({ limit: 1, offset: 0 })
      expect(first.items).toHaveLength(1)
      expect(first.items[0]?.id).toBe("job-readme")
      expect(first.total).toBe(2)

      const second = await caller.sync.list({ limit: 1, offset: 1 })
      expect(second.items).toHaveLength(1)
      expect(second.items[0]?.id).toBe("job-project")
    })
  })
})
