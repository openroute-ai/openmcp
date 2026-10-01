/**
 * Integration tests for the project list's ordering and type filter.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set, because what is being checked
 * here is what the *database* does with the query: a sort key that reaches
 * `orderBy` as the wrong direction, a nullable star count that Postgres sorts
 * first, and a page boundary that shifts when equal rows have no tiebreaker.
 * None of those are observable from a fake.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import { projectSyncJobs, projects, repos } from "@/db/schema"
import type { ProjectSort, ProjectType } from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { createCaller } from "@/lib/trpc/root"
import { fakeAdminContext } from "./helpers/fakes"
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
    stars: 0,
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
 * A repository and the project that owns it.
 *
 * Both go in through the same services the app uses, rather than as raw
 * inserts: `repos.id` and `projects.id` are generated in application code and
 * have no database default, so a hand-written insert would be testing a shape
 * the app never writes.
 *
 * `createdAt` and `stars` are set explicitly rather than left to defaults,
 * because the orders under test are orders *over those two values*: a fixture
 * that let Postgres fill them in would leave the assertions comparing equal
 * values, and passing for the wrong reason.
 */
async function seed(
  name: string,
  {
    type = "application" as ProjectType,
    // `null` as well as a number: a repository that has never been synced has
    // a null count, and that is the case the ordering has to survive.
    stars = 0 as number | null,
    createdAt = new Date("2026-01-01T00:00:00Z"),
  } = {}
) {
  const repo = await upsertRepo(
    db,
    repoInfo({
      name,
      fullName: `acme/${name}`,
      stars: stars ?? 0,
      pushedAt: createdAt,
    })
  )
  // `RepoInfo` types `stars` as a plain number, so a null count cannot be
  // written through it. Written back here for the same reason `createdAt` is
  // below: the column is nullable so "never read" and "read as zero" stay
  // different, and only the second is reachable through the service.
  if (stars === null) {
    await db.update(repos).set({ stars: null }).where(eq(repos.id, repo.id))
  }

  const project = await createProject(db, {
    repoId: repo.id,
    name,
    owner: "acme",
    slug: `acme-${name}`,
    description: "A thing",
    type,
  })
  // `createProject` has no `createdAt` field — a project's age is a property
  // of when it was curated, not something a caller chooses — so the column
  // default applies and every fixture would be "now". Written back here rather
  // than by hand-rolling the insert, so the row is still built the way the app
  // builds one.
  await db
    .update(projects)
    .set({ createdAt })
    .where(eq(projects.id, project.id))
  return project
}

/**
 * How many rows the fixture seeds. Written down once because the pagination
 * tests walk the list in pages and have to know when to stop: a count that
 * drifted from the seeds would silently assert over a short list and pass.
 */
const TOTAL = 11

const caller = createCaller(fakeAdminContext(db))

async function list(sort: ProjectSort, type?: ProjectType) {
  return caller.projects.list({ sort, type, limit: 100, offset: 0 })
}

const names = (result: { items: { name: string }[] }) =>
  result.items.map((item) => item.name)

describe.skipIf(!hasDatabase)("project list ordering (integration)", () => {
  beforeAll(async () => {
    await db.delete(projectSyncJobs)
    await db.delete(projects)
    await db.delete(repos)

    // Three ranks, so the star order has something to rank.
    await seed("high", { stars: 900 })
    await seed("mid", { stars: 50 })
    await seed("low", { stars: 1 })
    // Never synced, so its star count is null the way a real one's is.
    await seed("unsynced", { stars: null })

    // Every row gets an explicit `createdAt`, including the ones that exist
    // only for the star and type assertions. Left to the column default they
    // would all be "now", which is later than every date below and would make
    // them the newest rows — the created-order assertions would then be
    // testing the fixture's insertion order instead of the sort.
    await seed("first-created", { createdAt: new Date("2024-01-01T00:00:00Z") })
    await seed("last-created", { createdAt: new Date("2026-06-01T00:00:00Z") })
    await seed("middle-created", {
      createdAt: new Date("2025-01-01T00:00:00Z"),
    })

    // One of every type, for the filter. The rest of the fixture is
    // `application`, which is the schema default.
    await seed("a-skill", { type: "skill" })
    await seed("a-client", { type: "client" })
    await seed("a-server", { type: "server" })
    await seed("a-persona", { type: "persona" })
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("star order", () => {
    it("puts the most starred first and the least starred last", async () => {
      // Every other fixture has a count of zero or none, so the first three
      // are the only ones that can be ranked against each other.
      expect(names(await list("-stars")).slice(0, 3)).toEqual([
        "high",
        "mid",
        "low",
      ])
    })

    it("keeps the projects whose star count is unknown below every known one", async () => {
      // Postgres treats null as the largest value under `desc`, so without an
      // explicit `nulls last` the "most starred" list opens with every project
      // that has no number at all — the exact opposite of what it claims to
      // rank. The zero-count projects are the ones this bites hardest: they
      // are known to be small, and a null sorts above them.
      const items = (await list("-stars")).items

      const firstUnknown = items.findIndex((item) => item.stars === null)
      const lastKnown = items.reduce(
        (last, item, index) => (item.stars === null ? last : index),
        -1
      )

      expect(firstUnknown).toBeGreaterThan(0)
      expect(firstUnknown).toBeGreaterThan(lastKnown)
    })

    it("orders ascending without the unknown counts rising back to the top", async () => {
      const items = (await list("stars")).items
      const known = items.filter((item) => item.stars !== null)

      // Ascending puts the zero-count fixtures first, so the ranked three are
      // the *last* known rows, not the first.
      expect(known.map((item) => item.name).slice(-3)).toEqual([
        "low",
        "mid",
        "high",
      ])
      // Under `asc` the default puts nulls first, so a repository that has
      // never been counted would be read as the smallest project there is.
      // The clause is the only thing standing between the two lists and that.
      expect(items.findIndex((item) => item.stars === null)).toBeGreaterThan(
        known.length - 1
      )
    })
  })

  describe("created order", () => {
    it("puts the newest first", async () => {
      const byDate = names(await list("-createdAt"))

      expect(byDate.indexOf("last-created")).toBeLessThan(
        byDate.indexOf("middle-created")
      )
      expect(byDate.indexOf("middle-created")).toBeLessThan(
        byDate.indexOf("first-created")
      )
    })

    it("reverses for ascending", async () => {
      const byDate = names(await list("createdAt"))

      expect(byDate.indexOf("first-created")).toBeLessThan(
        byDate.indexOf("middle-created")
      )
      expect(byDate.indexOf("middle-created")).toBeLessThan(
        byDate.indexOf("last-created")
      )
    })

    it("defaults to newest first when no sort is given", async () => {
      const { items } = await caller.projects.list({ limit: 100, offset: 0 })

      expect(items[0]?.name).toBe("last-created")
    })
  })

  describe("type filter", () => {
    it("returns only the requested type", async () => {
      const result = await list("-stars", "skill")

      expect(result.items.map((item) => item.name)).toEqual(["a-skill"])
    })

    it("counts the filtered rows, not the whole table", async () => {
      // A total that ignored the filter would let the pager offer a last page
      // that is empty, which reads as data loss rather than as a filter.
      for (const type of ["client", "server", "skill", "persona"] as const) {
        const result = await list("-stars", type)

        expect(result.total).toBe(1)
        expect(result.items).toHaveLength(1)
      }
    })

    it("keeps every type's own rows when nothing is filtered", async () => {
      const { total, items } = await list("-stars")

      expect(total).toBe(items.length)
      expect(total).toBe(TOTAL)
    })

    it("refuses a value that is not a project type", async () => {
      await expect(
        caller.projects.list({
          type: "database" as ProjectType,
          limit: 20,
          offset: 0,
        })
      ).rejects.toThrow()
    })
  })

  describe("pagination under a sort with ties", () => {
    it("gives every row exactly one page", async () => {
      // Eight of the twelve fixtures share a star count of zero and most share
      // a `createdAt`. Without a unique tiebreaker Postgres may return those
      // rows in any order, so one can land on both page one and page two, or on
      // neither, and the pages together are not the whole list.
      const seen: string[] = []
      for (let offset = 0; offset < TOTAL; offset += 5) {
        const { items } = await caller.projects.list({
          sort: "-stars",
          limit: 5,
          offset,
        })
        seen.push(...items.map((item) => item.name))
      }

      expect(seen).toHaveLength(TOTAL)
      expect(new Set(seen).size).toBe(TOTAL)
    })

    it("paginates the created order the same way", async () => {
      const seen: string[] = []
      for (let offset = 0; offset < TOTAL; offset += 4) {
        const { items } = await caller.projects.list({
          sort: "createdAt",
          limit: 4,
          offset,
        })
        seen.push(...items.map((item) => item.name))
      }

      expect(new Set(seen).size).toBe(TOTAL)
    })
  })
})
