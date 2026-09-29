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
  repoWeeklyStars,
  repos,
  snapshots,
  tags,
} from "@/db/schema"
import {
  buildRankingsForMonth,
  buildRankingsForWeek,
} from "@/lib/github/service/rankings"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { recordMonth } from "@/lib/github/service/snapshot"
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

describe.skipIf(!hasDatabase)("rankings (integration)", () => {
  beforeAll(async () => {
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStars)
    await db.delete(snapshots)
    await db.delete(tags)
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(projectsToTags)
    await db.delete(repoWeeklyStars)
    await db.delete(snapshots)
    await db.delete(projects)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("weekly", () => {
    it("ranks by gain and reports the running total", async () => {
      const fast = await seed()
      const slow = await seed()
      await seedWeeks(fast.repo.id, 100, 0, 50)
      await seedWeeks(slow.repo.id, 1000, 0, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.fullName).toBe(fast.fullName)
      expect(rankings.trending[0]?.delta).toBe(50)
      // Running total over all three weeks, not the previous gain plus this
      // one: 100 in week 8 plus 50 gained in week 10.
      expect(rankings.trending[0]?.stars).toBe(150)
      expect(rankings.trending[1]?.delta).toBe(10)
    })

    it("ranks by relative growth separately from raw gain", async () => {
      // The small repository grew faster in percentage terms even though it
      // gained a tenth as many stargazers, which is the whole point of the
      // second list.
      const small = await seed()
      const large = await seed()
      await seedWeeks(small.repo.id, 10, 0, 10)
      await seedWeeks(large.repo.id, 1000, 0, 50)

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
      await seedWeeks(tracked.repo.id, 100, 0, 10)
      await db
        .insert(repoWeeklyStars)
        .values({ repoId: fresh.repo.id, year: 2026, week: 10, stars: 999 })

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending.map((p) => p.fullName)).toEqual([
        tracked.fullName,
      ])
    })

    it("returns empty lists for a week with no data", async () => {
      const repo = await seed()
      await seedWeeks(repo.repo.id, 5, 0, 0)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 11 })

      // Absent, not zero: an empty ranking must not be published over a good
      // one, and the task keys that decision off this being empty.
      expect(rankings.trending).toEqual([])
      expect(rankings.byRelativeGrowth).toEqual([])
    })
  })

  describe("monthly", () => {
    it("ranks by the difference between consecutive months", async () => {
      const repo = await seed()
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2026, month: 1 },
        { stars: 100 }
      )
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2026, month: 2 },
        { stars: 160 }
      )

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 2 })

      expect(rankings.trending[0]?.delta).toBe(60)
      expect(rankings.trending[0]?.stars).toBe(160)
      expect(rankings.trending[0]?.relativeGrowth).toBe(0.6)
    })

    it("compares January against the previous December", async () => {
      // The boundary a naive "same year, month - 1" lookup gets wrong: the
      // December being compared lives in the previous year's snapshot row.
      const repo = await seed()
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2025, month: 12 },
        { stars: 200 }
      )
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2026, month: 1 },
        { stars: 260 }
      )

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 1 })

      expect(rankings.trending[0]?.delta).toBe(60)
    })

    it("skips a repository whose star count fell", async () => {
      // A fall is a correction or a transfer, not a riser. Ranking it as a
      // large negative delta would only add noise.
      const repo = await seed()
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2026, month: 1 },
        { stars: 300 }
      )
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2026, month: 2 },
        { stars: 250 }
      )

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 2 })

      expect(rankings.trending).toEqual([])
    })

    it("skips a month with nothing to compare against", async () => {
      const repo = await seed()
      await recordMonth(
        db,
        repo.repo.id,
        { year: 2026, month: 2 },
        { stars: 100 }
      )

      const rankings = await buildRankingsForMonth(db, { year: 2026, month: 2 })

      expect(rankings.trending).toEqual([])
    })
  })

  describe("exclusions", () => {
    it("omits a project whose tag excludes it from rankings", async () => {
      const visible = await seed()
      const hidden = await seed()
      await seedWeeks(visible.repo.id, 100, 0, 10)
      await seedWeeks(hidden.repo.id, 100, 0, 999)
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
      await seedWeeks(repo.repo.id, 100, 0, 10)
      await attach(repo.project.id, "cli")
      await attach(repo.project.id, "typescript")

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.tags.sort()).toEqual(["cli", "typescript"])
    })

    it("omits a hidden or deprecated project", async () => {
      const active = await seed()
      const hidden = await seed({ status: "hidden" })
      const deprecated = await seed({ status: "deprecated" })
      await seedWeeks(active.repo.id, 100, 0, 10)
      await seedWeeks(hidden.repo.id, 100, 0, 500)
      await seedWeeks(deprecated.repo.id, 100, 0, 500)

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
      await seedWeeks(repo.repo.id, 100, 0, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.description).toBe("The project description")
    })

    it("falls back to the repository description when the project has none", async () => {
      const repo = await seed({
        projectDescription: "",
        repoDescription: "The repository description",
      })
      await seedWeeks(repo.repo.id, 100, 0, 10)

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
      await seedWeeks(repo.repo.id, 100, 0, 10)

      const rankings = await buildRankingsForWeek(db, { year: 2026, week: 10 })

      expect(rankings.trending[0]?.description.length).toBeLessThanOrEqual(78)
      expect(rankings.trending[0]?.description).toMatch(/\.\.\.$/)
    })
  })
})
