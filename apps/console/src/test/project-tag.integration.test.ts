/**
 * Integration tests for the project and tag services.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set. These cover behaviour that
 * only exists in the database: the unique constraints, the override flags
 * that protect human edits, and the ranking-exclusion filter.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { projects, repos, tags } from "@/db/schema"
import {
  createProject,
  generateUniqueSlug,
  getProjectByFullName,
  getProjectBySlug,
  listAllProjects,
  listProjects,
  slugify,
  syncProjectFromRepo,
  updateProject,
} from "@/lib/github/service/project"
import {
  addProjectTag,
  getTagByCode,
  listProjectTags,
  listRankingTags,
  setProjectTags,
  tagUsage,
  upsertTag,
} from "@/lib/github/service/tag"
import { upsertRepo } from "@/lib/github/service/repo"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function repoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    name: "thing",
    fullName: "acme/thing",
    owner: "acme",
    ownerId: 1,
    description: "The original description",
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

/** Creates a repository plus a project that points at it. */
async function seedProject(
  owner: string,
  name: string,
  overrides: Partial<Parameters<typeof createProject>[1]> = {}
) {
  const repo = await upsertRepo(db, repoInfo({ owner, name }))
  const project = await createProject(db, {
    repoId: repo.id,
    name,
    owner,
    slug: `${owner}-${name}`,
    description: "The original description",
    url: "https://example.com",
    ...overrides,
  })
  return { repo, project }
}

describe.skipIf(!hasDatabase)("project and tag services (integration)", () => {
  beforeAll(async () => {
    await db.delete(projects)
    await db.delete(tags)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("slugify", () => {
    it("normalises names into URL-safe slugs", () => {
      expect(slugify("Next.js")).toBe("next-js")
      expect(slugify("  MCP  Server  ")).toBe("mcp-server")
      expect(slugify("a/b_c")).toBe("a-b-c")
      expect(slugify("---")).toBe("")
    })

    it("caps the length so a long name cannot produce an unbounded slug", () => {
      expect(slugify("x".repeat(200))).toHaveLength(80)
    })
  })

  describe("generateUniqueSlug", () => {
    it("returns the base slug when it is free", async () => {
      expect(await generateUniqueSlug(db, "Brand New Thing")).toBe(
        "brand-new-thing"
      )
    })

    it("suffixes when the slug is taken, including a passed-in set", async () => {
      // seedProject derives the slug as `${owner}-${name}`.
      const { project } = await seedProject("acme", "clash")
      expect(project.slug).toBe("acme-clash")

      expect(await generateUniqueSlug(db, "acme-clash")).toBe("acme-clash-2")

      // A slug reserved by work that has not been inserted yet must also be
      // skipped, otherwise two concurrent creates collide on the unique index.
      const pending = new Set(["acme-clash-2"])
      expect(await generateUniqueSlug(db, "acme-clash", pending)).toBe(
        "acme-clash-3"
      )
    })
  })

  describe("createProject", () => {
    it("stores the project and joins its repository", async () => {
      const { project } = await seedProject("acme", "widget")

      const stored = await getProjectBySlug(db, project.slug)
      expect(stored?.name).toBe("widget")
      expect(stored?.repo.owner).toBe("acme")
      expect(stored?.status).toBe("active")
      expect(stored?.type).toBe("application")
    })

    it("substitutes a placeholder for a missing description", async () => {
      const repo = await upsertRepo(db, repoInfo({ owner: "nodesc" }))
      const project = await createProject(db, {
        repoId: repo.id,
        name: "nodesc",
        owner: "nodesc",
        slug: "nodesc",
        description: "",
      })

      expect(project.description).toBe("(No description)")
    })

    it("finds a project by owner and name", async () => {
      await seedProject("acme", "findme")
      expect((await getProjectByFullName(db, "acme/findme"))?.slug).toBe(
        "acme-findme"
      )
      expect(await getProjectByFullName(db, "acme/nothing")).toBeUndefined()
    })

    it("rejects a duplicate slug", async () => {
      await seedProject("acme", "dup")
      const repo = await upsertRepo(db, repoInfo({ owner: "other" }))
      await expect(
        createProject(db, {
          repoId: repo.id,
          name: "dup2",
          owner: "other",
          slug: "acme-dup",
        })
      ).rejects.toThrow()
    })
  })

  describe("listProjects", () => {
    it("excludes hidden projects unless asked", async () => {
      await seedProject("acme", "visible")
      await seedProject("acme", "invisible", { status: "hidden" })

      const listed = await listProjects(db, { limit: 500 })
      const slugs = listed.map((p) => p.slug)

      expect(slugs).toContain("acme-visible")
      expect(slugs).not.toContain("acme-invisible")

      const includingHidden = await listProjects(db, {
        includeHidden: true,
        limit: 500,
      })
      expect(includingHidden.map((p) => p.slug)).toContain("acme-invisible")
    })

    it("filters by type", async () => {
      await seedProject("acme", "askill", { type: "skill" })
      const skills = await listProjects(db, { type: "skill", limit: 500 })
      expect(skills.every((p) => p.type === "skill")).toBe(true)
    })

    it("caps listProjects at its default, which is why sync needs the other one", async () => {
      // The cap is fine for a page of results and wrong for a sync, so this
      // pins the difference: a catalogue larger than the page size is silently
      // truncated by listProjects and only listAllProjects sees all of it.
      //
      // Counted relative to a baseline because this suite shares one database
      // with the tests above rather than truncating between them.
      const before = (await listAllProjects(db)).length
      for (let index = 0; index < 105; index++) {
        await seedProject("bulk", `p${String(index).padStart(3, "0")}`)
      }

      expect(await listProjects(db, { limit: 500 })).toHaveLength(before + 105)
      // Still one page, so the tail is missing.
      expect(await listProjects(db)).toHaveLength(100)
      expect(await listAllProjects(db)).toHaveLength(before + 105)
    })

    it("pages past the first read in listAllProjects", async () => {
      // Past the 200-row page size, so the loop is entered more than once and
      // the offset is actually exercised.
      const before = (await listAllProjects(db)).length
      for (let index = 0; index < 250; index++) {
        await seedProject("deep", `d${String(index).padStart(3, "0")}`)
      }

      const all = await listAllProjects(db)
      const slugs = new Set(all.map((p) => p.slug))

      expect(all).toHaveLength(before + 250)
      // Duplicates across the page boundary would mean the offset drifted, and
      // a row skipped at the seam would mean the total came up short.
      expect(slugs.size).toBe(before + 250)
      expect(slugs.has("deep-d249")).toBe(true)
    })
  })

  describe("updateProject", () => {
    it("changes only the fields it is given", async () => {
      const { project } = await seedProject("acme", "partial")
      await updateProject(db, project.id, { priority: 5 })

      const stored = await getProjectBySlug(db, project.slug)
      expect(stored?.priority).toBe(5)
      expect(stored?.description).toBe("The original description")
      expect(stored?.url).toBe("https://example.com")
    })
  })

  describe("syncProjectFromRepo", () => {
    it("inherits description and homepage from the repository", async () => {
      const { project } = await seedProject("acme", "inherits")
      await upsertRepo(
        db,
        repoInfo({
          owner: "acme",
          name: "inherits",
          description: "A fresher description",
          homepage: "https://new.example.com",
        })
      )

      await syncProjectFromRepo(db, project.id)
      const stored = await getProjectBySlug(db, project.slug)

      expect(stored?.description).toBe("A fresher description")
      expect(stored?.url).toBe("https://new.example.com")
    })

    it("does not overwrite a human-edited description", async () => {
      const { project } = await seedProject("acme", "curated")
      await updateProject(db, project.id, {
        description: "Written by a human",
        overrideDescription: true,
      })
      await upsertRepo(
        db,
        repoInfo({ owner: "acme", name: "curated", description: "From GitHub" })
      )

      await syncProjectFromRepo(db, project.id)
      const stored = await getProjectBySlug(db, project.slug)

      expect(stored?.description).toBe("Written by a human")
    })

    it("does not overwrite a human-edited homepage", async () => {
      const { project } = await seedProject("acme", "curatedurl")
      await updateProject(db, project.id, {
        url: "https://curated.example.com",
        overrideUrl: true,
      })
      await upsertRepo(
        db,
        repoInfo({
          owner: "acme",
          name: "curatedurl",
          homepage: "https://github.example.com",
        })
      )

      await syncProjectFromRepo(db, project.id)
      const stored = await getProjectBySlug(db, project.slug)

      expect(stored?.url).toBe("https://curated.example.com")
    })
  })

  describe("tags", () => {
    it("upserts by code, keeping the identifier stable across a rename", async () => {
      const first = await upsertTag(db, { code: "mcp", name: "MCP" })
      const second = await upsertTag(db, {
        code: "mcp",
        name: "Model Context Protocol",
      })

      expect(second.id).toBe(first.id)
      expect(second.name).toBe("Model Context Protocol")
    })

    it("assigns and lists tags", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      await upsertTag(db, { code: "agent", name: "Agent" })
      const { project } = await seedProject("acme", "tagged")

      await setProjectTags(db, project.id, ["mcp", "agent"])
      const assigned = await listProjectTags(db, project.id)

      expect(assigned.map((t) => t.code).sort()).toEqual(["agent", "mcp"])
    })

    it("replaces the whole set rather than accumulating", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      await upsertTag(db, { code: "agent", name: "Agent" })
      const { project } = await seedProject("acme", "retagged")

      await setProjectTags(db, project.id, ["mcp", "agent"])
      await setProjectTags(db, project.id, ["agent"])

      const assigned = await listProjectTags(db, project.id)
      expect(assigned.map((t) => t.code)).toEqual(["agent"])
    })

    it("clears every tag when given an empty set", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      const { project } = await seedProject("acme", "untagged")
      await setProjectTags(db, project.id, ["mcp"])

      await setProjectTags(db, project.id, [])
      expect(await listProjectTags(db, project.id)).toHaveLength(0)
    })

    it("deduplicates a repeated code", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      const { project } = await seedProject("acme", "dupetags")

      await setProjectTags(db, project.id, ["mcp", "mcp"])
      expect(await listProjectTags(db, project.id)).toHaveLength(1)
    })

    it("rejects an unknown tag instead of silently dropping it", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      const { project } = await seedProject("acme", "badtags")

      await expect(
        setProjectTags(db, project.id, ["mcp", "nonexistent"])
      ).rejects.toThrow(/nonexistent/)

      // The transaction must have rolled back, leaving nothing assigned.
      expect(await listProjectTags(db, project.id)).toHaveLength(0)
    })

    it("adds and removes a single tag idempotently", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      const { project } = await seedProject("acme", "onebyone")

      await addProjectTag(db, project.id, "mcp")
      await addProjectTag(db, project.id, "mcp")
      expect(await listProjectTags(db, project.id)).toHaveLength(1)

      const { removeProjectTag } = await import("@/lib/github/service/tag")
      await removeProjectTag(db, project.id, "mcp")
      await removeProjectTag(db, project.id, "mcp")
      expect(await listProjectTags(db, project.id)).toHaveLength(0)
    })

    it("keeps ranking-excluded tags off a ranking", async () => {
      for (const code of ["meta", "learning", "wildcard"]) {
        await upsertTag(db, { code, name: code, excludeFromRankings: true })
      }
      const { eq } = await import("drizzle-orm")
      const { tags: tagsTable } = await import("@/db/schema")
      const mcp = await getTagByCode(db, "mcp")
      if (mcp) await db.delete(tagsTable).where(eq(tagsTable.id, mcp.id))
      await upsertTag(db, { code: "mcp", name: "MCP" })
      const { project } = await seedProject("acme", "ranked")

      await setProjectTags(db, project.id, [
        "mcp",
        "meta",
        "learning",
        "wildcard",
      ])

      const all = await listProjectTags(db, project.id)
      const ranking = await listRankingTags(db, project.id)

      expect(all).toHaveLength(4)
      expect(ranking.map((t) => t.code)).toEqual(["mcp"])
    })

    it("defaults new tags to the old hardcoded exclusions", async () => {
      const { inArray } = await import("drizzle-orm")
      const { tags: tagsTable } = await import("@/db/schema")
      await db.delete(tagsTable).where(inArray(tagsTable.code, ["meta", "mcp"]))

      // A legacy code created with no flag is excluded, exactly as the source
      // app excluded it by comparing codes to a constant...
      await upsertTag(db, { code: "meta", name: "meta" })
      expect((await getTagByCode(db, "meta"))?.excludeFromRankings).toBe(true)

      // ...an editor clearing it sticks, because the column is now the source
      // of truth and the list is only a default for new tags...
      await upsertTag(db, {
        code: "meta",
        name: "meta",
        excludeFromRankings: false,
      })
      expect((await getTagByCode(db, "meta"))?.excludeFromRankings).toBe(false)

      // ...ordinary codes are never excluded by default...
      await upsertTag(db, { code: "mcp", name: "MCP" })
      expect((await getTagByCode(db, "mcp"))?.excludeFromRankings).toBe(false)

      // ...and re-upserting a tag for its display name keeps whatever it had.
      await upsertTag(db, {
        code: "mcp",
        name: "MCP",
        excludeFromRankings: true,
      })
      await upsertTag(db, { code: "mcp", name: "The MCPs" })
      expect((await getTagByCode(db, "mcp"))?.excludeFromRankings).toBe(true)
    })

    it("counts tag usage including unused tags", async () => {
      await upsertTag(db, { code: "mcp", name: "MCP" })
      await upsertTag(db, { code: "unused", name: "Unused" })
      const { project } = await seedProject("acme", "counted")
      await setProjectTags(db, project.id, ["mcp"])

      const usage = await tagUsage(db)
      const mcp = usage.find((u) => u.code === "mcp")
      const unused = usage.find((u) => u.code === "unused")

      expect(mcp?.count).toBeGreaterThan(0)
      expect(unused?.count).toBe(0)
    })
  })
})
