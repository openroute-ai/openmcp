/**
 * Integration tests for the rankings WebUI surfaces: the dashboard router and
 * the public JSON endpoints.
 *
 * The services they wrap are covered deeply by `rankings.integration.test.ts`
 * and `rising-stars.integration.test.ts`. What these tests protect is the
 * wiring: the right period reaches the right service, a reading surfaces the
 * seeded data, an explicit period wins over the default, and a malformed
 * period is a clear error rather than a silently different result.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createCaller } from "@/lib/trpc/root"
import { db, pool } from "@/db/client"
import {
  projects,
  projectsToTags,
  repoWeeklyStars,
  repos,
  risingStarCategories,
  risingStarProjects,
  snapshots,
  tags,
} from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { recordMonth } from "@/lib/github/service/snapshot"
import {
  resolveMonthInput,
  resolveWeekInput,
  resolveYearInput,
} from "@/lib/rankings-web"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let nextId = 0

function info(overrides: Partial<RepoInfo>): RepoInfo {
  const n = (nextId += 1)
  const owner = `owner${n}`
  const name = `repo${n}`

  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 2000 + n,
    description: "The repository description",
    homepage: "",
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

async function seed(overrides: Record<string, unknown> = {}) {
  const n = (nextId += 1)
  const repo = await upsertRepo(db, info({}))

  const project = await createProject(db, {
    repoId: repo.id,
    name: (overrides.projectName as string) ?? `Project ${n}`,
    owner: repo.owner,
    slug: (overrides.slug as string) ?? `slug-${n}`,
    description:
      (overrides.projectDescription as string) ?? "The project description",
    url: "https://example.com",
    status: (overrides.status as "active") ?? "active",
    type: "application",
  })

  return { repo, project, fullName: `${repo.owner}/${repo.name}` }
}

/** Three weekly rows, so the running total has to span more than one delta. */
async function seedWeeks(
  repoId: string,
  oldest: number,
  middle: number,
  latest: number
) {
  await db
    .insert(repoWeeklyStars)
    .values([
      { repoId, year: 2026, week: 8, stars: oldest },
      { repoId, year: 2026, week: 9, stars: middle },
      { repoId, year: 2026, week: 10, stars: latest },
    ])
    .onConflictDoNothing()
}

/** A record for one month in the running-total history. */
async function record(
  repoId: string,
  year: number,
  month: number,
  stars: number
) {
  await recordMonth(db, repoId, { year, month }, { stars })
}

/**
 * Records the closing month of the year before plus every month of `year`,
 * so each month has a predecessor and a measurable delta.
 */
async function recordYear(
  repoId: string,
  year: number,
  first: number,
  growth: number
) {
  await record(repoId, year - 1, 12, first)
  for (let month = 1; month <= 12; month++) {
    await record(repoId, year, month, first + growth * month)
  }
  await record(repoId, year + 1, 1, first + growth * 13)
}

describe.skipIf(!hasDatabase)("rankings webui (integration)", () => {
  const caller = createCaller({
    db,
    session: {} as never,
    headers: new Headers({ authorization: "Bearer test" }),
  })

  beforeAll(async () => {
    await db.delete(risingStarProjects)
    await db.delete(risingStarCategories)
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStars)
    await db.delete(snapshots)
    await db.delete(tags)
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(risingStarProjects)
    await db.delete(risingStarCategories)
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStars)
    await db.delete(snapshots)
    await db.delete(projects)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("period resolution", () => {
    it("defaults a week to the last complete week", () => {
      const resolved = resolveWeekInput({}, new Date("2026-09-29T00:00:00Z"))
      expect(resolved).toEqual({ ok: true, value: { year: 2026, week: 39 } })
    })

    it("fills the current year when only a week is given", () => {
      const resolved = resolveWeekInput({ week: 10 })
      expect(resolved).toEqual({
        ok: true,
        value: { year: new Date().getFullYear(), week: 10 },
      })
    })

    it("defaults a month to the previous month across a year boundary", () => {
      const resolved = resolveMonthInput({}, new Date("2026-01-15T00:00:00Z"))
      expect(resolved).toEqual({ ok: true, value: { year: 2025, month: 12 } })
    })

    it("defaults a year to the one that just ended", () => {
      expect(resolveYearInput({}, new Date("2026-09-29T00:00:00Z"))).toEqual({
        ok: true,
        value: 2025,
      })
    })

    it("rejects an out-of-range week", () => {
      const resolved = resolveWeekInput({ week: 54 })
      expect(resolved).toEqual({
        ok: false,
        error: "week must be an integer between 1 and 53",
      })
    })
  })

  describe("dashboard router", () => {
    it("serves a weekly ranking from the database", async () => {
      const fast = await seed()
      const slow = await seed()
      await seedWeeks(fast.repo.id, 100, 0, 50)
      await seedWeeks(slow.repo.id, 1000, 0, 10)

      const result = await caller.rankings.weekly({ year: 2026, week: 10 })

      expect(result.period).toBe("week")
      expect(result.trending[0]?.fullName).toBe(fast.fullName)
      expect(result.trending[0]?.delta).toBe(50)
      expect(result.byRelativeGrowth[0]?.fullName).toBe(fast.fullName)
    })

    it("serves a monthly ranking from the database", async () => {
      const repo = await seed()
      await record(repo.repo.id, 2025, 12, 1000)
      await record(repo.repo.id, 2026, 1, 1100)
      await record(repo.repo.id, 2026, 2, 1150)

      const result = await caller.rankings.monthly({ year: 2026, month: 2 })

      expect(result.period).toBe("month")
      expect(result.trending[0]?.fullName).toBe(repo.fullName)
      expect(result.trending[0]?.delta).toBe(50)
    })

    it("serves a Rising Stars year from the database", async () => {
      const repo = await seed()
      await recordYear(repo.repo.id, 2025, 0, 100)

      const result = await caller.rankings.risingStars({ year: 2025 })

      expect(result.count).toBe(1)
      expect(result.projects[0]?.full_name).toBe(repo.fullName)
      expect(result.projects[0]?.delta).toBe(1200)
    })

    it("defaults to the last complete period when nothing is passed", async () => {
      const result = await caller.rankings.weekly({})
      expect(result.period).toBe("week")
      // What week that is depends on today, so only the shape is asserted.
      expect(result.week).toBeGreaterThanOrEqual(1)
    })
  })

  describe("public endpoints", () => {
    type WeekRoute = typeof import("@/app/api/rankings/week.json/route")
    type MonthRoute = typeof import("@/app/api/rankings/month.json/route")
    type RisingRoute =
      typeof import("@/app/api/rankings/rising-stars.json/route")
    let weekRoute: WeekRoute
    let monthRoute: MonthRoute
    let risingRoute: RisingRoute

    async function call(
      route: WeekRoute | MonthRoute | RisingRoute,
      path: string
    ): Promise<Response> {
      return route.GET(new Request(`https://console.test/api/rankings/${path}`))
    }

    beforeAll(async () => {
      weekRoute = await import("@/app/api/rankings/week.json/route")
      monthRoute = await import("@/app/api/rankings/month.json/route")
      risingRoute = await import("@/app/api/rankings/rising-stars.json/route")
    })

    it("serves week.json with an explicit period", async () => {
      const repo = await seed()
      await seedWeeks(repo.repo.id, 100, 0, 50)

      const response = await call(weekRoute, "week.json?year=2026&week=10")

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        period: string
        trending: { fullName: string }[]
      }
      expect(body.period).toBe("week")
      expect(body.trending[0]?.fullName).toBe(repo.fullName)
    })

    it("serves month.json with an explicit period", async () => {
      const repo = await seed()
      await record(repo.repo.id, 2025, 12, 1000)
      await record(repo.repo.id, 2026, 1, 1000)
      await record(repo.repo.id, 2026, 2, 1010)

      const response = await call(monthRoute, "month.json?year=2026&month=2")

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        period: string
        trending: { delta: number }[]
      }
      expect(body.period).toBe("month")
      expect(body.trending[0]?.delta).toBe(10)
    })

    it("serves rising-stars.json for a seeded year", async () => {
      const repo = await seed()
      await recordYear(repo.repo.id, 2025, 0, 100)

      const response = await call(risingRoute, "rising-stars.json?year=2025")

      expect(response.status).toBe(200)
      const body = (await response.json()) as { count: number }
      expect(body.count).toBe(1)
    })

    it("returns 404 when the period has no data", async () => {
      const response = await call(weekRoute, "week.json?year=2026&week=10")
      expect(response.status).toBe(404)
    })

    it("returns 400 for a malformed period", async () => {
      const response = await call(weekRoute, "week.json?week=54")
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "week must be an integer between 1 and 53",
      })
    })

    it("returns 400 for a malformed year", async () => {
      const response = await call(monthRoute, "month.json?year=twenty")
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "year must be four digits",
      })
    })
  })
})
