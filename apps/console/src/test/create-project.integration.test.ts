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
import { syncSkillsForProject } from "@/lib/github/sync-skills"
import { GitHubNotFoundError } from "@/lib/github/errors"
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
    openIssuesCount: 1,
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
        readPath: vi.fn(async () => ({
          kind: "file" as const,
          content: "",
        })),
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
        readPath: vi.fn(async () => {
          throw new Error("SKILL.md unreachable")
        }),
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

    it("records a missing SKILL.md as an empty sync, not a failure", async () => {
      // A repository that has no SKILL.md at the configured path is a state,
      // not an outage: the next run will read the same 404. Recording it as
      // failed left the project reporting an error forever for a path that was
      // simply wrong.
      const c = client({
        readPath: vi.fn(async () => {
          throw new GitHubNotFoundError("contents/SKILL.md")
        }),
        // The default path is missing, so the repository is asked where its
        // skills are. This one has none either, which is the state under test.
        findSkillDocuments: vi.fn(async () => ({
          paths: [],
          truncated: false,
        })),
      })

      const result = await createProjectFromRepo(
        db,
        { url: "acme/skill-absent", type: "skill" },
        deps(c)
      )

      expect(result.status).toBe("created")
      expect(result.skills).toEqual({ count: 0, translated: 0, empty: true })

      const jobs = await db.query.projectSyncJobs.findMany({
        where: (t, { eq: e }) => e(t.projectId, result.project.id),
      })

      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.status).toBe("success")
      expect(jobs[0]!.errorMessage).toBeNull()
    })

    it("reads every subdirectory when the path is a directory of skills", async () => {
      // The layout a name-based check cannot recognise: nothing about the
      // default `SKILL.md` says the repository keeps its skills in a directory,
      // so the sync has to ask GitHub which it is rather than assume from the
      // path it was configured with.
      const c = client({
        readPath: vi.fn(async (_fullName: string, path: string) => {
          if (path === "skills") {
            return {
              kind: "directory" as const,
              entries: [
                { name: "pdf", path: "skills/pdf", type: "dir" },
                { name: "xlsx", path: "skills/xlsx", type: "dir" },
                { name: "README.md", path: "skills/README.md", type: "file" },
              ],
            }
          }
          const name = path.split("/").slice(1, 2).join("")
          return {
            kind: "file" as const,
            content: `---\nname: ${name}\ndescription: does ${name}\n---\nbody`,
          }
        }),
      })

      const created = await createProjectFromRepo(
        db,
        { url: "acme/skill-dir", type: "skill" },
        deps(c)
      )

      const project = await getProjectByFullName(db, "acme/skill-dir")
      await db
        .update(projects)
        .set({ skillMdPath: "skills" })
        .where(eq(projects.id, created.project.id))
      const repo = await getRepoByFullName(db, "acme/skill-dir")

      const result = await syncSkillsForProject(
        db,
        c,
        { project: { ...project!, skillMdPath: "skills" }, repo: repo! },
        { logger: createBufferingLogger() }
      )

      expect(result).toMatchObject({ skills: 2, empty: false })

      const stored = await db.query.projectSkills.findMany({
        where: (t, { eq: e }) => e(t.projectId, created.project.id),
      })
      // Keyed by directory, not by the configured path, so a later switch to
      // file mode stores under different keys instead of overwriting these.
      expect(stored.map((row) => row.skillDir).sort()).toEqual(["pdf", "xlsx"])
    })

    it("keeps stored skills when the path stops resolving", async () => {
      const first = client({
        readPath: vi.fn(async () => ({
          kind: "file" as const,
          content: "---\nname: pdf\n---\nbody",
        })),
      })
      const created = await createProjectFromRepo(
        db,
        { url: "acme/skill-regressed", type: "skill" },
        deps(first)
      )
      expect(
        await db.query.projectSkills.findMany({
          where: (t, { eq: e }) => e(t.projectId, created.project.id),
        })
      ).toHaveLength(1)

      // The file is gone upstream. An empty discovery must not unpublish what
      // is already stored.
      const second = client({
        readPath: vi.fn(async () => {
          throw new GitHubNotFoundError("contents/SKILL.md")
        }),
        // Only the file disappeared, not the whole repository, so discovery
        // finds the layout the stored rows came from and reports it as absent
        // rather than as a repository with no skills at all.
        findSkillDocuments: vi.fn(async () => ({
          paths: [],
          truncated: false,
        })),
      })
      const project = await getProjectByFullName(db, "acme/skill-regressed")
      const repo = await getRepoByFullName(db, "acme/skill-regressed")

      const result = await syncSkillsForProject(
        db,
        second,
        { project: project!, repo: repo! },
        { logger: createBufferingLogger() }
      )

      expect(result).toMatchObject({ skills: 0, empty: true })
      expect(
        await db.query.projectSkills.findMany({
          where: (t, { eq: e }) => e(t.projectId, created.project.id),
        })
      ).toHaveLength(1)
    })

    it("asks the repository where its skills are when the default path is absent", async () => {
      // The case that made every submission of a conventionally-laid-out
      // repository report zero skills: `SKILL.md` is the schema default, not a
      // description of anyone's layout, and a repository that keeps its skills
      // in `.agents/skills` was answering "nothing here" to a path that was
      // never going to resolve.
      const c = client({
        readPath: vi.fn(async (_fullName: string, path: string) => {
          if (path === "SKILL.md") {
            throw new GitHubNotFoundError("contents/SKILL.md")
          }
          if (path === ".agents/skills") {
            return {
              kind: "directory" as const,
              entries: [
                { name: "pdf", path: ".agents/skills/pdf", type: "dir" },
                { name: "xlsx", path: ".agents/skills/xlsx", type: "dir" },
              ],
            }
          }
          const name = path.split("/").slice(2, 3).join("")
          return {
            kind: "file" as const,
            content: `---\nname: ${name}\ndescription: does ${name}\n---\nbody`,
          }
        }),
        findSkillDocuments: vi.fn(async () => ({
          paths: [
            ".agents/skills/pdf/SKILL.md",
            ".agents/skills/xlsx/SKILL.md",
          ],
          truncated: false,
        })),
      })

      const created = await createProjectFromRepo(
        db,
        { url: "acme/skill-agents-dir", type: "skill" },
        deps(c)
      )

      const project = await getProjectByFullName(db, "acme/skill-agents-dir")
      const repo = await getRepoByFullName(db, "acme/skill-agents-dir")

      const result = await syncSkillsForProject(
        db,
        c,
        { project: project!, repo: repo! },
        { logger: createBufferingLogger() }
      )

      expect(result).toMatchObject({ skills: 2, empty: false })

      const stored = await db.query.projectSkills.findMany({
        where: (t, { eq: e }) => e(t.projectId, created.project.id),
      })
      expect(stored.map((row) => row.skillDir).sort()).toEqual(["pdf", "xlsx"])

      // Written back, so the next sweep does not pay for the same dead lookup
      // and the operator sees the path that actually holds the skills.
      const after = await getProjectByFullName(db, "acme/skill-agents-dir")
      expect(after?.skillMdPath).toBe(".agents/skills")
    })

    it("leaves a path somebody set alone, even when discovery finds skills", async () => {
      // A typo in a configured path should be reported, not silently replaced
      // by a guess: a working import would hide the one thing the operator
      // needed to see.
      const c = client({
        readPath: vi.fn(async (_fullName: string, path: string) => {
          if (path === ".agents/skills") {
            return {
              kind: "directory" as const,
              entries: [
                { name: "pdf", path: ".agents/skills/pdf", type: "dir" },
              ],
            }
          }
          if (path === ".agents/skills/pdf/SKILL.md") {
            return {
              kind: "file" as const,
              content: "---\nname: pdf\n---\nbody",
            }
          }
          throw new GitHubNotFoundError(`contents/${path}`)
        }),
        findSkillDocuments: vi.fn(async () => ({
          paths: [".agents/skills/pdf/SKILL.md"],
          truncated: false,
        })),
      })

      const created = await createProjectFromRepo(
        db,
        { url: "acme/skill-typo", type: "skill" },
        deps(c)
      )
      await db
        .update(projects)
        .set({ skillMdPath: "skils" })
        .where(eq(projects.id, created.project.id))

      const project = await getProjectByFullName(db, "acme/skill-typo")
      const repo = await getRepoByFullName(db, "acme/skill-typo")

      // Creating the project already ran one sync against the untouched default,
      // and that one is allowed to search. What must not happen is a second
      // search for a path somebody has since set.
      const askedBefore = (c.findSkillDocuments as ReturnType<typeof vi.fn>)
        .mock.calls.length

      const result = await syncSkillsForProject(
        db,
        c,
        { project: { ...project!, skillMdPath: "skils" }, repo: repo! },
        { logger: createBufferingLogger() }
      )

      expect(result).toMatchObject({ skills: 0, empty: true })
      expect(
        (c.findSkillDocuments as ReturnType<typeof vi.fn>).mock.calls.length
      ).toBe(askedBefore)

      const after = await getProjectByFullName(db, "acme/skill-typo")
      expect(after?.skillMdPath).toBe("skils")
    })
  })
})
