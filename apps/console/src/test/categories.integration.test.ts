/**
 * Integration tests for the category management router.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set. What these protect is the
 * wiring the dashboard relies on: the list carries a per-category project count,
 * an edit updates by `id` and leaves `code` alone, the detail read pages the
 * projects filed under a category, and deleting a category unfiles its projects
 * rather than deleting them (`ON DELETE SET NULL`).
 */
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { categories, projects, repos } from "@/db/schema"
import { createCaller } from "@/lib/trpc/root"
import { createProject } from "@/lib/github/service/project"
import { setProjectCategory } from "@/lib/github/service/category"
import { upsertRepo } from "@/lib/github/service/repo"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import { fakeAdminContext, fakeUserContext } from "./helpers/fakes"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let nextId = 0

function info(stars = 10): RepoInfo {
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
    stars,
    topics: [],
    archived: false,
    commitCount: 1,
    lastCommit: new Date("2026-06-01T00:00:00Z"),
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
  }
}

/** Creates a project, and files it under `categoryId` when one is given. */
async function seedProject(
  options: {
    categoryId?: string | null
    name?: string
    stars?: number
  } = {}
) {
  const repo = await upsertRepo(db, info(options.stars))
  const project = await createProject(db, {
    repoId: repo.id,
    name: options.name ?? `Project ${nextId}`,
    owner: repo.owner,
    slug: `slug-${nextId}`,
    description: "The project description",
    status: "active",
    type: "application",
  })
  if (options.categoryId) {
    await setProjectCategory(db, project.id, options.categoryId)
  }
  return { repo, project }
}

async function clean() {
  await db.delete(projects)
  await db.delete(categories)
  await db.delete(repos)
}

describe.skipIf(!hasDatabase)("categories router (integration)", () => {
  const caller = createCaller(fakeAdminContext(db))

  beforeAll(clean)
  beforeEach(clean)
  afterAll(async () => {
    await pool.end()
  })

  it("creates a category and returns it with a zero project count", async () => {
    await caller.categories.create({
      code: "mcp-server",
      name: "MCP 服务器",
      description: "The model context protocol servers",
      sortOrder: 2,
    })

    const rows = await caller.categories.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      code: "mcp-server",
      name: "MCP 服务器",
      isActive: true,
      sortOrder: 2,
      projectCount: 0,
    })
  })

  it("edits by id and leaves the code unchanged", async () => {
    const row = await caller.categories.create({
      code: "agents",
      name: "Agents",
    })

    await caller.categories.update({
      id: row.id,
      name: "智能体",
      isActive: false,
      sortOrder: 5,
    })

    const updated = await caller.categories.get({ code: "agents" })
    expect(updated).toMatchObject({
      code: "agents",
      name: "智能体",
      isActive: false,
      sortOrder: 5,
    })
  })

  it("counts the projects filed under each category", async () => {
    const category = await caller.categories.create({
      code: "frameworks",
      name: "Frameworks",
    })
    await seedProject({ categoryId: category.id })
    await seedProject({ categoryId: category.id })
    await seedProject()

    const rows = await caller.categories.list()
    expect(rows.find((r) => r.id === category.id)?.projectCount).toBe(2)
  })

  it("pages the projects filed under a category", async () => {
    const category = await caller.categories.create({
      code: "clients",
      name: "Clients",
    })
    for (let index = 0; index < 3; index += 1) {
      await seedProject({ categoryId: category.id, stars: index })
    }
    await seedProject()

    const first = await caller.categories.projects({
      code: "clients",
      limit: 2,
      offset: 0,
    })
    expect(first.total).toBe(3)
    expect(first.items).toHaveLength(2)
    expect(first.category.code).toBe("clients")

    // `-stars` orders most-starred first, so the third project lands on page two.
    const second = await caller.categories.projects({
      code: "clients",
      limit: 2,
      offset: 2,
    })
    expect(second.total).toBe(3)
    expect(second.items).toHaveLength(1)
    expect(second.items[0]?.stars).toBe(0)
  })

  it("filters the detail list by search term", async () => {
    const category = await caller.categories.create({
      code: "tools",
      name: "Tools",
    })
    await seedProject({ categoryId: category.id, name: "Alpha" })
    await seedProject({ categoryId: category.id, name: "Beta" })

    const result = await caller.categories.projects({
      code: "tools",
      search: "Alpha",
    })
    expect(result.total).toBe(1)
    expect(result.items[0]?.name).toBe("Alpha")
  })

  it("unfiles projects when a category is deleted", async () => {
    const category = await caller.categories.create({
      code: "retired",
      name: "Retired",
    })
    const { project } = await seedProject({ categoryId: category.id })

    const result = await caller.categories.remove({ id: category.id })
    expect(result.unfiled).toBe(1)

    const [stored] = await db
      .select({ categoryId: projects.categoryId })
      .from(projects)
      .where(eq(projects.id, project.id))
    expect(stored?.categoryId).toBeNull()
  })

  it("answers 404 for a code that does not exist", async () => {
    await expect(
      caller.categories.projects({ code: "missing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("refuses a non-admin caller", async () => {
    const userCaller = createCaller(fakeUserContext(db))

    await expect(userCaller.categories.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
  })
})
