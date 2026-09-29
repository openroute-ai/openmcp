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
import { db, pool } from "@/db/client"
import {
  projectSkills,
  projects,
  projectSyncJobs,
  readmeSyncJobs,
  repoWeeklyStars,
  repos,
  snapshots,
  tags,
  projectsToTags,
  taskDefinitions,
  taskExecutions,
  taskStatus,
} from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { seedDefinitions } from "@/lib/tasks/seed"
import { resetSyncEnvCache } from "@/lib/env"
import type { RepoInfo } from "@/lib/github/repo-info-query"

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

async function seedProject() {
  const repo = await upsertRepo(db, info())
  const project = await createProject(db, {
    repoId: repo.id,
    name: `Project ${nextId}`,
    owner: repo.owner,
    slug: `slug-${nextId}`,
    description: "The project description",
    status: "active",
    type: "skill",
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
  await db.delete(repoWeeklyStars)
  await db.delete(snapshots)
  await db.delete(tags)
  await db.delete(projects)
  await db.delete(repos)
  await db.delete(taskExecutions)
  await db.delete(taskStatus)
  await db.delete(taskDefinitions)
}

describe.skipIf(!hasDatabase)("admin webui (integration)", () => {
  const caller = createCaller({
    db,
    session: {} as never,
    headers: new Headers({ authorization: "Bearer test" }),
  })

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

    it("lists the most recent task executions first", async () => {
      const definitionId = await taskId("build-weekly-rankings")
      await db.insert(taskExecutions).values([
        {
          id: "exec-a",
          taskDefinitionId: definitionId,
          status: "completed",
          startedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "exec-b",
          taskDefinitionId: definitionId,
          status: "failed",
          startedAt: new Date("2026-01-02T00:00:00Z"),
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

    it("rejects an unknown task", async () => {
      await expect(
        caller.tasks.runNow({ name: "no-such-task" })
      ).rejects.toThrow(/unknown task/)
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

      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe(project.id)
      expect(result[0]?.stars).toBe(repo.stars)
      expect(result[0]?.skillCount).toBe(1)
      expect(result[0]?.lastSync?.status).toBe("success")
      expect(result[0]?.lastSync?.id).toBe("job-new")
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

      expect(all).toHaveLength(3)
      expect(pending).toHaveLength(1)
      expect(pending[0]?.skillDir).toBe("pending")
      expect(synced).toHaveLength(1)
      expect(synced[0]?.skillDir).toBe("synced")
      expect(errored).toHaveLength(1)
      expect(errored[0]?.lastSyncError).toBe("push failed")
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
      expect(all).toHaveLength(2)
      expect(all[0]?.kind).toBe("readme")
      expect(all[0]?.ref).toBe(`${repo.owner}/${repo.name}`)
      expect(all[1]?.kind).toBe("project")
      expect(all[1]?.ref).toBe(project.name)

      const pending = await caller.sync.list({ status: "pending" })
      expect(pending).toHaveLength(1)
      expect(pending[0]?.id).toBe("job-readme")
    })
  })
})
