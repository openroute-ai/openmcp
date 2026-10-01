/**
 * Integration tests for the ranking assembly.
 *
 * Covers the rules that decide who appears at all, because those are the ones
 * that fail quietly: a project dropped from a ranking looks identical to a
 * project that simply did not grow.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import {
  projects,
  projectsToTags,
  repoMonthlyStats,
  repoWeeklyStats,
  repos,
  tags,
} from "@/db/schema"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
} from "@/lib/github/service/rankings"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  periodFromMonth,
  periodFromWeek,
  previousIsoWeek,
  type YearMonth,
} from "@/lib/github/snapshot-dates"
import { upsertStatsRow } from "@/lib/github/service/stats"
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
    ownerId: 1000 + n,
    description: "The repository description",
    homepage: "",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    pushedAt: new Date("2024-06-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 100,
    topics: [],
    archived: false,
    commitCount: 10,
    lastCommit: new Date("2024-06-01T00:00:00Z"),
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

/** A repository plus its project, with a unique name per call. */
async function seed(overrides: Record<string, unknown> = {}) {
  const n = (nextId += 1)
  const repo = await upsertRepo(
    db,
    info({
      description:
        (overrides.repoDescription as string) ?? "The repository description",
    })
  )

  const project = await createProject(db, {
    repoId: repo.id,
    name: (overrides.projectName as string) ?? `Project ${n}`,
    owner: repo.owner,
    slug: `slug-${n}`,
    description:
      (overrides.projectDescription as string) ?? "The project description",
    url: "https://example.com",
    status: (overrides.status as "active") ?? "active",
    type: "application",
  })

  return { repo, project, fullName: `${repo.owner}/${repo.name}` }
}

async function tag(code: string, excludeFromRankings = false) {
  const [row] = await db
    .insert(tags)
    .values({ id: `tag-${code}`, code, name: code, excludeFromRankings })
    .onConflictDoUpdate({
      target: tags.code,
      set: { excludeFromRankings },
    })
    .returning()
  return row!
}

/**
 * Attaches a tag to a project.
 *
 * `excluded` defaults to false so the common case reads as a plain tag; the
 * ranking-exclusion tests pass it explicitly rather than relying on a tag's
 * name, since the exclusion is the column's job, not a convention about which
 * codes are special.
 */
async function attach(projectId: string, tagCode: string, excluded = false) {
  const row = await tag(tagCode, excluded)
  await db
    .insert(projectsToTags)
    .values({ projectId, tagId: row.id })
    .onConflictDoNothing()
}

/** The week every weekly case ranks, and the one before it. */
const WEEK = { year: 2026, week: 10 }

/**
 * A repository's week: what it had before, and what it gained during it.
 *
 * Two rows, because the ranking needs both halves and refuses to publish
 * without them: the previous period's existence is what proves the repository
 * was already being measured, and the current period carries the change and the
 * closing level side by side rather than leaving the reader to subtract.
 */
async function seedWeek(repoId: string, before: number, delta: number) {
  await weekRow(repoId, previousIsoWeek(WEEK), { totalStars: before })
  await weekRow(repoId, WEEK, { totalStars: before + delta, deltaStars: delta })
}

/** A weekly row on the instant Shanghai's ISO week opened. */
async function weekRow(
  repoId: string,
  yearWeek: { year: number; week: number },
  columns: { totalStars: number; deltaStars?: number | null }
) {
  await upsertStatsRow(db, "week", repoId, periodFromWeek(yearWeek), {
    levels: { stars: columns.totalStars },
    ...(columns.deltaStars === undefined || columns.deltaStars === null
      ? {}
      : { changes: { stars: columns.deltaStars } }),
  })
}

/** The same pair of rows for a month. */
async function seedMonth(repoId: string, yearMonth: YearMonth, before: number, delta: number) {
  await monthRow(repoId, previousMonthOf(yearMonth), before, null)
  await monthRow(repoId, yearMonth, before + delta, delta)
}

/** A monthly row, filed on the instant Shanghai's month opened. */
async function monthRow(
  repoId: string,
  yearMonth: YearMonth,
  totalStars: number,
  deltaStars: number | null
) {
  await upsertStatsRow(db, "month", repoId, periodFromMonth(yearMonth), {
    levels: { stars: totalStars },
    ...(deltaStars === null ? {} : { changes: { stars: deltaStars } }),
  })
}

/** The month before a given one, across the year boundary. */
function previousMonthOf({ year, month }: YearMonth): YearMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

describe.skipIf(!hasDatabase)("rankings (integration)", () => {
  beforeAll(async () => {
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
    await db.delete(tags)
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
    await db.delete(projects)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("weekly", () => {
    it("ranks by gain and reports the running total", async () => {
      const fast = await seed()
      const slow = await seed()
      await seedWeek(fast.repo.id, 100, 50)
      await seedWeek(slow.repo.id, 1000, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.fullName).toBe(fast.fullName)
      expect(rankings.trending[0]?.delta).toBe(50)
      // The level the week closed at, not this week's gain on its own.
      expect(rankings.trending[0]?.stars).toBe(150)
      expect(rankings.trending[1]?.delta).toBe(10)
    })

    it("ranks by relative growth separately from raw gain", async () => {
      // The small repository grew faster in percentage terms even though it
      // gained a tenth as many stargazers, which is the whole point of the
      // second list.
      const small = await seed()
      const large = await seed()
      await seedWeek(small.repo.id, 10, 10)
      await seedWeek(large.repo.id, 1000, 50)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.fullName).toBe(large.fullName)
      expect(rankings.byRelativeGrowth[0]?.fullName).toBe(small.fullName)
      expect(rankings.byRelativeGrowth[0]?.relativeGrowth).toBe(1)
      expect(rankings.byRelativeGrowth[1]?.relativeGrowth).toBe(0.05)
    })

    it("skips a repository with no row for the previous week", async () => {
      // A newly tracked repository has nothing to be measured against. Ranking
      // it against zero would report infinite growth and put it first.
      const tracked = await seed()
      const fresh = await seed()
      await seedWeek(tracked.repo.id, 100, 10)
      await weekRow(fresh.repo.id, WEEK, { totalStars: 999, deltaStars: 999 })

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending.map((p) => p.fullName)).toEqual([
        tracked.fullName,
      ])
    })

    it("returns empty lists for a week with no data", async () => {
      const repo = await seed()
      await seedWeek(repo.repo.id, 5, 0)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 11 })

      // Absent, not zero: an empty ranking must not be published over a good
      // one, and the task keys that decision off this being empty.
      expect(rankings.trending).toEqual([])
      expect(rankings.byRelativeGrowth).toEqual([])
    })
  })

  describe("monthly", () => {
    it("ranks by the change stored beside the level", async () => {
      const repo = await seed()
      await seedMonth(repo.repo.id, { year: 2026, month: 2 }, 100, 60)

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 2 })

      expect(rankings.trending[0]?.delta).toBe(60)
      expect(rankings.trending[0]?.stars).toBe(160)
      // 60 against the 100 it had before, which the row itself carries.
      expect(rankings.trending[0]?.relativeGrowth).toBe(0.6)
    })

    it("compares January against the previous December", async () => {
      // The boundary a naive "same year, month - 1" lookup gets wrong: the
      // December being compared lives in the previous year's row.
      const repo = await seed()
      await seedMonth(repo.repo.id, { year: 2026, month: 1 }, 200, 60)

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 1 })

      expect(rankings.trending[0]?.delta).toBe(60)
    })

    it("skips a repository whose star count fell", async () => {
      // A fall is a correction or a transfer, not a riser. Ranking it as a
      // large negative delta would only add noise.
      const repo = await seed()
      await seedMonth(repo.repo.id, { year: 2026, month: 2 }, 300, -50)

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 2 })

      expect(rankings.trending).toEqual([])
    })

    it("skips a month with nothing to compare against", async () => {
      const repo = await seed()
      await monthRow(
        repo.repo.id,
        { year: 2026, month: 2 },
        100,
        null
      )

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 2 })

      expect(rankings.trending).toEqual([])
    })
  })

  describe("exclusions", () => {
    it("omits a project whose tag excludes it from rankings", async () => {
      const visible = await seed()
      const hidden = await seed()
      await seedWeek(visible.repo.id, 100, 10)
      await seedWeek(hidden.repo.id, 100, 999)
      await attach(hidden.project.id, "meta", true)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      // The repository grew far more, and is still absent: the exclusion is the
      // whole reason the flag exists.
      expect(rankings.trending.map((p) => p.fullName)).toEqual([
        visible.fullName,
      ])
    })

    it("still lists the tags of a project that is ranked", async () => {
      const repo = await seed()
      await seedWeek(repo.repo.id, 100, 10)
      await attach(repo.project.id, "cli")
      await attach(repo.project.id, "typescript")

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.tags.sort()).toEqual(["cli", "typescript"])
    })

    it("omits a hidden or deprecated project", async () => {
      const active = await seed()
      const hidden = await seed({ status: "hidden" })
      const deprecated = await seed({ status: "deprecated" })
      await seedWeek(active.repo.id, 100, 10)
      await seedWeek(hidden.repo.id, 100, 500)
      await seedWeek(deprecated.repo.id, 100, 500)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending.map((p) => p.fullName)).toEqual([
        active.fullName,
      ])
    })
  })

  describe("descriptions", () => {
    it("prefers the project's own description", async () => {
      const repo = await seed({
        projectDescription: "The project description",
        repoDescription: "The repository description",
      })
      await seedWeek(repo.repo.id, 100, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.description).toBe("The project description")
    })

    it("falls back to the repository description when the project has none", async () => {
      const repo = await seed({
        projectDescription: "",
        repoDescription: "The repository description",
      })
      await seedWeek(repo.repo.id, 100, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.description).toBe(
        "The repository description"
      )
    })

    it("truncates a long description", async () => {
      const repo = await seed({
        projectDescription: "word ".repeat(40),
        repoDescription: "unused",
      })
      await seedWeek(repo.repo.id, 100, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.description.length).toBeLessThanOrEqual(78)
      expect(rankings.trending[0]?.description).toMatch(/\.\.\.$/)
    })
  })
})
