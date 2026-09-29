/**
 * Integration tests for creating a project from a GitHub URL.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set. What is covered here is
 * behaviour that only exists in the database: idempotency by repository, slug
 * collisions between two repositories of the same name, the author link, and
 * the sync job rows a create is supposed to leave behind.
 *
 * The GitHub client is faked, so these tests assert what the create flow does
 * with a repository, not that GitHub answers correctly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import { projects, repos } from "@/db/schema"
import {
  InvalidRepoUrlError,
  createProjectFromRepo,
} from "@/lib/github/service/create-project"
import {
  getProjectByFullName,
  getProjectBySlug,
} from "@/lib/github/service/project"
import { getRepoByFullName } from "@/lib/github/service/repo"
import { createBufferingLogger } from "@/lib/tasks/runner"
import { fakeGitHubClient } from "./helpers/fakes"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function repoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    name: "thing",
    fullName: "acme/thing",
    owner: "acme",
    ownerId: 1,
    description: "A thing",
    homepage: "https://example.com",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-01-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 10,
    topics: [],
    archived: false,
    commitCount: 1,
    lastCommit: new Date("2026-01-01T00:00:00Z"),
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
    ...overrides,
  }
}

/**
 * A client that reports the repository it was asked about.
 *
 * Echoing the requested full name matters: a fixed one would store every
 * repository under the same row, and an assertion looking the project up by
 * the URL it was created from would fail for the wrong reason.
 */
function client(overrides: Parameters<typeof fakeGitHubClient>[0] = {}) {
  return fakeGitHubClient({
    fetchRepoInfo: vi.fn(async (fullName: string) => {
      const [owner, name] = fullName.split("/")
      return repoInfo({ owner, name, fullName, ownerId: 1 })
    }),
    fetchRepoReadMeAsMarkdown: vi.fn(async () => "# Thing"),
    ...overrides,
  })
}

const deps = (c = client()) => ({ client: c, logger: createBufferingLogger() })

describe.skipIf(!hasDatabase)("createProjectFromRepo (integration)", () => {
  beforeAll(async () => {
    await db.delete(projects)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("input handling", () => {
    it("rejects a URL that is not a GitHub repository", async () => {
      await expect(
        createProjectFromRepo(
          db,
          { url: "https://example.com/not-github" },
          deps()
        )
      ).rejects.toBeInstanceOf(InvalidRepoUrlError)
    })

    it("accepts every URL shape the parser supports", async () => {
      for (const [index, url] of [
        "acme/one",
        "https://github.com/acme/two",
        "git@github.com:acme/three.git",
        "github.com/acme/four",
      ].entries()) {
        const c = client({
          fetchRepoInfo: vi.fn(async () =>
            repoInfo({ name: `repo${index}`, fullName: `acme/repo${index}` })
          ),
        })
        const result = await createProjectFromRepo(db, { url }, deps(c))
        expect(result.status).toBe("created")
      }
    })
  })

  describe("creation", () => {
    it("creates a repo, a project and links the author", async () => {
      const c = client()
      const result = await createProjectFromRepo(
        db,
        { url: "https://github.com/acme/created" },
        deps(c)
      )

      expect(result.status).toBe("created")
      expect(result.project.slug).toBe("created")
      expect(result.project.type).toBe("application")
      expect(result.authorLinked).toBe(true)

      expect(c.fetchRepoInfo).toHaveBeenCalledWith("acme/created")

      const repo = await getRepoByFullName(db, "acme/created")
      expect(repo).not.toBeNull()

      const author = await db.query.hallOfFame.findFirst({
        where: (t, { eq: e }) => e(t.username, "acme"),
      })
      expect(author).toBeDefined()

      const link = await db.query.hallOfFameToProjects.findFirst({
        where: (t, { eq: e }) => e(t.projectId, result.project.id),
      })
      expect(link?.username).toBe("acme")
    })

    it("defaults to an application rather than publishing as a skill", async () => {
      const c = client()
      const result = await createProjectFromRepo(
        db,
        { url: "acme/defaulted" },
        deps(c)
      )

      expect(result.project.type).toBe("application")
      expect(result.skills).toBeNull()
    })

    it("honours an explicit type, including skill", async () => {
      const result = await createProjectFromRepo(
        db,
        { url: "acme/persona-typed", type: "persona" },
        deps()
      )

      expect(result.project.type).toBe("persona")
    })

    it("reuses a stored repository instead of re-fetching it", async () => {
      const first = client()
      await createProjectFromRepo(db, { url: "acme/reused" }, deps(first))
      expect(first.fetchRepoInfo).toHaveBeenCalledTimes(1)

      // A second create for a different URL form of the same repository, after
      // removing the project, must not spend another fetch.
      await db.delete(projects).where(eq(projects.slug, "reused"))

      const second = client()
      await createProjectFromRepo(
        db,
        { url: "git@github.com:acme/reused.git" },
        deps(second)
      )

      expect(second.fetchRepoInfo).not.toHaveBeenCalled()
    })
  })

  describe("idempotency", () => {
    it("returns the existing project for a repository that already has one", async () => {
      const c = client()
      const first = await createProjectFromRepo(
        db,
        { url: "acme/twice" },
        deps(c)
      )
      const second = await createProjectFromRepo(
        db,
        { url: "acme/twice" },
        deps(c)
      )

      expect(first.status).toBe("created")
      expect(second.status).toBe("existing")
      expect(second.project.id).toBe(first.project.id)

      // Only the first call fetched, so the second was a lookup.
      expect(c.fetchRepoInfo).toHaveBeenCalledTimes(1)
    })

    it("does not leave a second project row behind", async () => {
      await createProjectFromRepo(db, { url: "acme/single" }, deps())
      await createProjectFromRepo(db, { url: "acme/single" }, deps())

      const matches = await db.query.projects.findMany({
        where: (t, { eq: e }) => e(t.slug, "single"),
      })
      expect(matches).toHaveLength(1)
    })

    it("gives a different owner the same name its own slug", async () => {
      const a = client({
        fetchRepoInfo: vi.fn(async () => repoInfo({ name: "dup" })),
      })
      const b = client({
        fetchRepoInfo: vi.fn(async () =>
          repoInfo({ name: "dup", fullName: "other/dup", owner: "other" })
        ),
      })

      const first = await createProjectFromRepo(
        db,
        { url: "acme/dup" },
        deps(a)
      )
      const second = await createProjectFromRepo(
        db,
        { url: "other/dup" },
        deps(b)
      )

      expect(first.project.slug).toBe("dup")
      expect(second.project.slug).not.toBe("dup")

      expect(await getProjectBySlug(db, "dup")).toBeTruthy()
      expect(await getProjectByFullName(db, "other/dup")).toBeTruthy()
    })
  })

  describe("sync jobs", () => {
    it("records a successful readme sync", async () => {
      const result = await createProjectFromRepo(
        db,
        { url: "acme/readme-ok" },
        deps()
      )

      expect(result.readme).toEqual({ synced: true })

      const repo = await getRepoByFullName(db, "acme/readme-ok")
      const jobs = await db.query.readmeSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.repoId, repo!.id),
      })

      expect(jobs).toHaveLength(1)
      expect(jobs[0]!).toMatchObject({
        status: "success",
        triggeredBy: "project_create",
        errorMessage: null,
      })
      expect(jobs[0]!.completedAt).not.toBeNull()
    })

    it("records a failed readme sync without failing the create", async () => {
      const c = client({
        fetchRepoReadMeAsMarkdown: vi.fn(async () => {
          throw new Error("README fetch exploded")
        }),
      })

      const result = await createProjectFromRepo(
        db,
        { url: "acme/readme-bad" },
        deps(c)
      )

      // The project is still published: a secondary fetch failing is not a
      // reason to discard the curation the operator asked for.
      expect(result.status).toBe("created")
      expect(result.readme.synced).toBe(false)
      expect(result.readme.error).toContain("README fetch exploded")

      const repo = await getRepoByFullName(db, "acme/readme-bad")
      const jobs = await db.query.readmeSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.repoId, repo!.id),
      })

      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.status).toBe("failed")
      expect(jobs[0]!.errorMessage).toContain("README fetch exploded")
    })

    it("treats a repository with no README as a success, not a failure", async () => {
      const c = client({ fetchRepoReadMeAsMarkdown: vi.fn(async () => null) })

      const result = await createProjectFromRepo(
        db,
        { url: "acme/no-readme" },
        deps(c)
      )

      expect(result.readme).toEqual({ synced: false })

      const repo = await getRepoByFullName(db, "acme/no-readme")
      const jobs = await db.query.readmeSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.repoId, repo!.id),
      })

      expect(jobs[0]!.status).toBe("success")
    })

    it("does not record a project sync job for a non-skill project", async () => {
      const result = await createProjectFromRepo(
        db,
        { url: "acme/no-project-job" },
        deps()
      )

      const jobs = await db.query.projectSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.projectId, result.project.id),
      })

      expect(jobs).toHaveLength(0)
    })
  })

  describe("skill projects", () => {
    it("records a project sync job for a skill project", async () => {
      const c = client({
        fetchFileContent: vi.fn(async () => ""),
        listDirectory: vi.fn(async () => []),
      })

      const result = await createProjectFromRepo(
        db,
        { url: "acme/skill-one", type: "skill" },
        deps(c)
      )

      expect(result.skills).toEqual({
        count: 0,
        translated: 0,
        empty: true,
      })

      const jobs = await db.query.projectSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.projectId, result.project.id),
      })

      expect(jobs).toHaveLength(1)
      expect(jobs[0]!).toMatchObject({
        status: "success",
        triggeredBy: "project_create",
      })
    })

    it("records a failed project sync when the skill fetch throws", async () => {
      const c = client({
        fetchFileContent: vi.fn(async () => {
          throw new Error("SKILL.md unreachable")
        }),
        listDirectory: vi.fn(async () => []),
      })

      const result = await createProjectFromRepo(
        db,
        { url: "acme/skill-bad", type: "skill" },
        deps(c)
      )

      expect(result.status).toBe("created")

      const jobs = await db.query.projectSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.projectId, result.project.id),
      })

      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.status).toBe("failed")
      expect(jobs[0]!.errorMessage).toContain("SKILL.md unreachable")
    })
  })
})
