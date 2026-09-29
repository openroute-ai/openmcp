/**
 * Integration tests for package, bundle, author and skill persistence.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import { packages, repos } from "@/db/schema"
import {
  bundleErrorFor,
  getBundle,
  getPackage,
  listBundles,
  listPackageNames,
  listPackagesForProject,
  listPackagesWithBundles,
  upsertBundle,
  upsertPackage,
} from "@/lib/github/service/package"
import {
  createProject,
  deleteProject,
  getProjectById,
} from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  getSkill,
  listFailedSkills,
  listSkillProjects,
  listSkillsForProject,
  listSkillsNeedingPush,
  listUnpushedSkills,
  recordPushFailure,
  recordPushSuccess,
  syncProjectSkills,
  upsertSkill,
} from "@/lib/github/service/skill"
import {
  getAuthor,
  githubAvatarUrl,
  linkAuthorToProject,
  listAuthors,
  listAuthorsForProject,
  listVerifiedAuthors,
  setAuthorProjects,
  upsertAuthor,
  upsertAuthorFromRepo,
} from "@/lib/github/service/hall-of-fame"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function repoInfo(owner: string, name: string): RepoInfo {
  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 1,
    description: "",
    homepage: "",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-01-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 0,
    topics: [],
    archived: false,
    commitCount: 0,
    lastCommit: new Date(0),
    mentionableUsersCount: 0,
    watchersCount: 0,
    licenseSpdxId: "",
    pullRequestsCount: 0,
    releasesCount: 0,
    languages: [],
    forks: 0,
    openGraphImageUrl: "",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "",
    latestReleaseTagName: "",
    latestReleasePublishedAt: undefined,
    latestReleaseUrl: "",
    latestReleaseDescription: "",
  }
}

async function seedRepo(owner: string, name: string) {
  return upsertRepo(db, repoInfo(owner, name))
}

/** Each describe truncates the tables it touches, so slugs stay unique. */
let slugSuffix = 0

async function seedProject(owner: string, name: string, type = "application") {
  const repo = await seedRepo(owner, name)
  slugSuffix += 1
  return createProject(db, {
    repoId: repo.id,
    name,
    owner,
    slug: `${owner}-${name}-${slugSuffix}`,
    type: type as "application" | "skill",
  })
}

describe.skipIf(!hasDatabase)("catalog services (integration)", () => {
  beforeAll(async () => {
    // Deleting repos cascades to projects, packages, bundles and skills, which
    // resets every uniqueness constraint these tests rely on.
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("packages and bundles", () => {
  it("stores a package and reads it back", async () => {
    const project = await seedProject("pkg", "one")
    await upsertPackage(db, project.id, {
      name: "one",
      version: "1.0.0",
      dependencies: { react: "^18.0.0" },
    })

    const stored = await getPackage(db, "one")
    expect(stored?.version).toBe("1.0.0")
    expect(stored?.dependencies).toEqual(["react@^18.0.0"])
    expect(stored?.projectId).toBe(project.id)
  })

  it("updates a package in place rather than duplicating it", async () => {
    const project = await seedProject("pkg", "two")
    await upsertPackage(db, project.id, { name: "two", version: "1.0.0" })
    await upsertPackage(db, project.id, { name: "two", version: "2.0.0" })

    const all = await listPackagesForProject(db, project.id)
    expect(all).toHaveLength(1)
    expect(all[0]?.version).toBe("2.0.0")
  })

  it("records a deprecation from npm's message form", async () => {
    await upsertPackage(db, null, {
      name: "deprecated-pkg",
      version: "1.0.0",
      deprecated: "use something-else instead",
    })

    expect((await getPackage(db, "deprecated-pkg"))?.deprecated).toBe(true)
  })

  it("stores a failed bundle measurement with its outcome", async () => {
    // A bundle row references its package, so the package must exist first.
    await upsertPackage(db, null, { name: "timeout-pkg", version: "1.0.0" })
    await upsertBundle(db, {
      name: "timeout-pkg",
      version: "1.0.0",
      size: null,
      gzip: null,
      errorMessage: bundleErrorFor("timeout"),
    })

    const bundle = await getBundle(db, "timeout-pkg")
    expect(bundle?.errorMessage).toBe("timeout")
    expect(bundle?.size).toBeNull()
  })

  it("clears a previous error when a measurement succeeds", async () => {
    await upsertPackage(db, null, { name: "retry-pkg", version: "1.0.0" })
    await upsertBundle(db, { name: "retry-pkg", errorMessage: "timeout" })
    await upsertBundle(db, {
      name: "retry-pkg",
      version: "1.0.0",
      size: 900,
      gzip: 200,
    })

    const bundle = await getBundle(db, "retry-pkg")
    expect(bundle?.errorMessage).toBeNull()
    expect(bundle?.size).toBe(900)
  })

  it("cascades a bundle away when its package is deleted", async () => {
    await upsertPackage(db, null, { name: "orphan-pkg", version: "1.0.0" })
    await upsertBundle(db, { name: "orphan-pkg", version: "1.0.0", size: 1 })

    await db.delete(packages).where(eq(packages.name, "orphan-pkg"))
    expect(await getBundle(db, "orphan-pkg")).toBeUndefined()
  })

  it("lists a package with no bundle alongside ones that have one", async () => {
    const project = await seedProject("pkg", "mixed")
    await upsertPackage(db, project.id, {
      name: "with-bundle",
      version: "1.0.0",
    })
    await upsertPackage(db, project.id, { name: "no-bundle", version: "1.0.0" })
    await upsertBundle(db, { name: "with-bundle", version: "1.0.0", size: 5 })

    const rows = await listPackagesWithBundles(db)
    const forProject = rows.filter((r) => r.project.id === project.id)
    expect(forProject).toHaveLength(2)
    expect(
      forProject.find((r) => r.package.name === "no-bundle")?.bundle
    ).toBeUndefined()
  })

  it("excludes a deprecated project from the bundling sweep", async () => {
    const repo = await seedRepo("pkg", "dead")
    slugSuffix += 1
    const project = await createProject(db, {
      repoId: repo.id,
      name: "dead",
      owner: "pkg",
      slug: `pkg-dead-${slugSuffix}`,
      status: "deprecated",
    })
    await upsertPackage(db, project.id, { name: "dead-pkg", version: "1.0.0" })

    const rows = await listPackagesWithBundles(db)
    expect(rows.some((r) => r.project.id === project.id)).toBe(false)
  })

  it("returns nothing for an empty bundle lookup", async () => {
    expect(await listBundles(db, [])).toEqual([])
  })

  it("lists every package name for a sweep", async () => {
    await upsertPackage(db, null, { name: "listed-pkg", version: "1.0.0" })
    expect(await listPackageNames(db)).toContain("listed-pkg")
  })
})

  describe("hall of fame", () => {
    it("adds an author", async () => {
      await upsertAuthor(db, { username: "ada" })

      const author = await getAuthor(db, "ada")
      expect(author?.name).toBe("ada")
      expect(author?.github).toBe("https://github.com/ada")
      expect(author?.verified).toBe(false)
    })

    it("refreshes derived fields without erasing curated ones", async () => {
      // A repository sync must not wipe the bio and followers that a separate
      // profile fetch recorded.
      await upsertAuthor(db, { username: "grace" }, { bio: "Compiler pioneer", followers: 900 })
      await upsertAuthor(db, { username: "grace" }, { homepage: "https://example.com" })

      const author = await getAuthor(db, "grace")
      expect(author?.bio).toBe("Compiler pioneer")
      expect(author?.followers).toBe(900)
      expect(author?.homepage).toBe("https://example.com")
    })

    it("adds an author from a repository owner", async () => {
      await upsertAuthorFromRepo(db, {
        owner: "linus",
        // The schema stores the numeric id as text.
        ownerId: "1",
        homepage: "https://kernel.org",
      })

      const author = await getAuthor(db, "linus")
      expect(author?.homepage).toBe("https://kernel.org")
      expect(author?.avatarUrl).toContain("avatars.githubusercontent.com/u/1")
    })

    it("skips a repository with no owner rather than writing a blank author", async () => {
      await upsertAuthorFromRepo(db, { owner: "", ownerId: null, homepage: null })
      expect(await listAuthors(db)).not.toContainEqual(
        expect.objectContaining({ username: "" })
      )
    })

    it("replaces an author's project set", async () => {
      const first = await seedProject("hof", "one")
      const second = await seedProject("hof", "two")
      await upsertAuthor(db, { username: "curator" })

      await setAuthorProjects(db, "curator", [first.id, second.id])
      expect(await listAuthorsForProject(db, first.id)).toHaveLength(1)

      // The link set is derived from a repository's curated projects, so a
      // project that is no longer curated must not linger.
      await setAuthorProjects(db, "curator", [second.id])
      expect(await listAuthorsForProject(db, first.id)).toHaveLength(0)
    })

    it("clears the project set when given none", async () => {
      const project = await seedProject("hof", "three")
      await upsertAuthor(db, { username: "solo" })
      await setAuthorProjects(db, "solo", [project.id])
      await setAuthorProjects(db, "solo", [])

      expect(await listAuthorsForProject(db, project.id)).toHaveLength(0)
    })

    it("does not duplicate a repeated link", async () => {
      const project = await seedProject("hof", "four")
      await upsertAuthor(db, { username: "dupe" })
      await linkAuthorToProject(db, "dupe", project.id)
      await linkAuthorToProject(db, "dupe", project.id)

      expect(await listAuthorsForProject(db, project.id)).toHaveLength(1)
    })

    it("lists only verified authors for the public directory", async () => {
      await upsertAuthor(db, { username: "shown", verified: true })
      await upsertAuthor(db, { username: "hidden", verified: false })

      const listed = await listVerifiedAuthors(db)
      expect(listed.map((a) => a.username)).toContain("shown")
      expect(listed.map((a) => a.username)).not.toContain("hidden")
    })

    it("builds an avatar URL from the numeric owner id", () => {
      expect(githubAvatarUrl(42)).toContain("/u/42")
      expect(githubAvatarUrl(null)).toBeNull()
    })
})

  describe("skills", () => {
    it("stores a parsed skill", async () => {
      const project = await seedProject("skill", "one", "skill")
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "Work with PDFs",
        version: "1.0.0",
        readme: "Body",
      })

      const stored = await getSkill(db, project.id, "pdf")
      expect(stored?.name).toBe("pdf")
      expect(stored?.syncedToWebAt).toBeNull()
    })

    it("updates a skill in place", async () => {
      const project = await seedProject("skill", "two", "skill")
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "Old",
        version: "1.0.0",
        readme: "Old body",
      })
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "New",
        version: "2.0.0",
        readme: "New body",
      })

      const skills = await listSkillsForProject(db, project.id)
      expect(skills).toHaveLength(1)
      expect(skills[0]?.description).toBe("New")
    })

    it("removes a skill that no longer exists upstream", async () => {
      const project = await seedProject("skill", "three", "skill")
      const base = {
        projectId: project.id,
        name: "a",
        description: "d",
        version: null,
        readme: "r",
      }
      await syncProjectSkills(db, project.id, [
        { ...base, skillDir: "keep" },
        { ...base, skillDir: "remove" },
      ])
      await syncProjectSkills(db, project.id, [{ ...base, skillDir: "keep" }])

      const skills = await listSkillsForProject(db, project.id)
      expect(skills.map((s) => s.skillDir)).toEqual(["keep"])
    })

    it("does not delete a project's skills on an empty discovery", () => {
      // An empty listing is ambiguous: either the repository has no skills or
      // the listing failed. Deleting on a transient failure would unpublish a
      // working project.
      return (async () => {
        const project = await seedProject("skill", "four", "skill")
        await syncProjectSkills(db, project.id, [
          {
            projectId: project.id,
            skillDir: "keep",
            name: "a",
            description: "d",
            version: null,
            readme: "r",
          },
        ])
        await syncProjectSkills(db, project.id, [])

        expect(await listSkillsForProject(db, project.id)).toHaveLength(1)
      })()
    })

    it("records a push attempt and then a success", async () => {
      const project = await seedProject("skill", "five", "skill")
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "d",
        version: null,
        readme: "r",
      })

    const at = new Date("2026-03-01T00:00:00Z")
    await recordPushSuccess(db, project.id, "pdf", at)

    const stored = await getSkill(db, project.id, "pdf")
    expect(stored?.syncedToWebAt?.toISOString()).toBe(at.toISOString())
    expect(stored?.lastSyncError).toBeNull()

    // Scoped to this skill, since other tests in this suite also have a
    // "pdf" skill that has deliberately never been pushed.
    const unpushed = await listUnpushedSkills(db)
    expect(
      unpushed.some((s) => s.projectId === project.id && s.skillDir === "pdf")
    ).toBe(false)
  })

    it("keeps a failed skill visible for retry", async () => {
      const project = await seedProject("skill", "six", "skill")
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "d",
        version: null,
        readme: "r",
      })

      await recordPushFailure(
        db,
        project.id,
        "pdf",
        "webhook returned 500",
        new Date("2026-03-01T00:00:00Z")
      )

      const failed = await listFailedSkills(db)
      expect(failed.some((s) => s.skillDir === "pdf")).toBe(true)
      // A failed push must also count as needing a push.
      const needing = await listSkillsNeedingPush(db)
      expect(needing.some((s) => s.skillDir === "pdf")).toBe(true)
    })

    it("truncates a very long push error", async () => {
      const project = await seedProject("skill", "seven", "skill")
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "d",
        version: null,
        readme: "r",
      })

      await recordPushFailure(
        db,
        project.id,
        "pdf",
        "x".repeat(5000),
        new Date()
      )

      const stored = await getSkill(db, project.id, "pdf")
      expect(stored?.lastSyncError?.length).toBe(2000)
    })

    it("lists only skill projects", async () => {
      const skill = await seedProject("skill", "eight", "skill")
      const app = await seedProject("skill", "nine", "application")

      const listed = await listSkillProjects(db)
      const ids = listed.map((row) => row.project.id)
      expect(ids).toContain(skill.id)
      expect(ids).not.toContain(app.id)
    })

    it("cascades skills away with their project", async () => {
      const project = await seedProject("skill", "ten", "skill")
      await upsertSkill(db, {
        projectId: project.id,
        skillDir: "pdf",
        name: "pdf",
        description: "d",
        version: null,
        readme: "r",
      })

      await deleteProject(db, project.id)

      expect(await listSkillsForProject(db, project.id)).toHaveLength(0)
      expect(await getProjectById(db, project.id)).toBeUndefined()
    })

    it("keeps a project and its repository readable", async () => {
      const project = await seedProject("skill", "eleven", "skill")
      const found = await getProjectById(db, project.id)
      // The slug carries the per-run suffix that keeps projects unique.
      expect(found?.slug).toMatch(/^skill-eleven-\d+$/)
      expect(found?.repo.name).toBe("eleven")
    })
  })
})
