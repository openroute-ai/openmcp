/**
 * Integration tests for the rankings WebUI surface: the dashboard router.
 *
 * The services it wraps are covered deeply by `rankings.integration.test.ts` and
 * `rising-stars.integration.test.ts`. What this protects is the wiring: the
 * right period reaches the right service, a reading surfaces the seeded data,
 * and an explicit period wins over the default.
 *
 * The four anonymous `*.json` routes that used to be covered here are gone — the
 * open API under `/api/v1/rankings/*` is the only way to read rankings now — so
 * their cases left with them.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createCaller } from "@/lib/trpc/root"
import { fakeAdminContext } from "./helpers/fakes"
import { db, pool } from "@/db/client"
import {
  projects,
  projectsToTags,
  repoMonthlyStats,
  repoWeeklyStats,
  repos,
  risingStarCategories,
  risingStarProjects,
  tags,
} from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  periodFromMonth,
  periodFromWeek,
  previousIsoWeek,
} from "@/lib/github/snapshot-dates"
import { upsertStatsRow } from "@/lib/github/service/stats"
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

/** The week the weekly cases rank. */
const WEEK = { year: 2026, week: 10 }

/**
 * A repository's week: what it had before, and what it gained during it.
 *
 * Two rows, because the ranking needs both halves and refuses to publish
 * without them: the previous period proves the repository was already being
 * measured, and the current period carries the change next to the level.
 */
async function seedWeeks(repoId: string, before: number, delta: number) {
  await weekRow(repoId, previousIsoWeek(WEEK), { totalStars: before })
  await weekRow(repoId, WEEK, { totalStars: before + delta, deltaStars: delta })
}

/** A weekly row on the instant Shanghai's ISO week opened. */
async function weekRow(
  repoId: string,
  yearWeek: { year: number; week: number },
  columns: { totalStars: number; deltaStars?: number }
) {
  await upsertStatsRow(db, "week", repoId, periodFromWeek(yearWeek), {
    levels: { stars: columns.totalStars },
    ...(columns.deltaStars === undefined ? {} : { changes: { stars: columns.deltaStars } }),
  })
}

/** One monthly row, carrying the level and, when it has one, the change. */
async function record(
  repoId: string,
  year: number,
  month: number,
  stars: number,
  delta?: number
) {
  await upsertStatsRow(db, "month", repoId, periodFromMonth({ year, month }), {
    levels: { stars },
    ...(delta === undefined ? {} : { changes: { stars: delta } }),
  })
}

/**
 * Records the closing month of the year before plus every month of `year`,
 * so each month has a predecessor and a measurable change.
 */
async function recordYear(
  repoId: string,
  year: number,
  first: number,
  growth: number
) {
  await record(repoId, year - 1, 12, first)
  for (let month = 1; month <= 12; month++) {
    await record(repoId, year, month, first + growth * month, growth)
  }
  await record(repoId, year + 1, 1, first + growth * 13, growth)
}

describe.skipIf(!hasDatabase)("rankings webui (integration)", () => {
  // Every procedure in this router is `adminProcedure`, so the caller has to be
  // an admin for the suite to reach anything. `admin-auth` covers the refusal.
  const caller = createCaller(fakeAdminContext(db))

  beforeAll(async () => {
    await db.delete(risingStarProjects)
    await db.delete(risingStarCategories)
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
    await db.delete(tags)
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(risingStarProjects)
    await db.delete(risingStarCategories)
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
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
      await seedWeeks(fast.repo.id, 100, 50)
      await seedWeeks(slow.repo.id, 1000, 10)

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
})
