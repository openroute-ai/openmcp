/**
 * Integration tests for the period lists behind the rankings period picker.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set. The behaviour worth pinning is
 * which periods get offered: the picker must list only weeks and months that
 * hold data, newest first, and must not repeat a period that several
 * repositories have rows for.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { repoWeeklyStars, repos, snapshots } from "@/db/schema"
import {
  listMonthlyPeriods,
  listWeeklyPeriods,
} from "@/lib/github/service/available-periods"
import { upsertRepo } from "@/lib/github/service/repo"
import { recordMonth } from "@/lib/github/service/snapshot"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let nextId = 0

function info(overrides: Partial<RepoInfo> = {}): RepoInfo {
  const n = (nextId += 1)
  const owner = `periods${n}`
  const name = `repo${n}`

  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 2000 + n,
    description: "",
    homepage: "",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    pushedAt: new Date("2024-06-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 1,
    topics: [],
    archived: false,
    commitCount: 1,
    lastCommit: new Date("2024-06-01T00:00:00Z"),
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

async function seedRepo(): Promise<string> {
  const repo = await upsertRepo(db, info())
  return repo.id
}

describe.skipIf(!hasDatabase)("available ranking periods (integration)", () => {
  beforeEach(async () => {
    await db.delete(repoWeeklyStars)
    await db.delete(snapshots)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("listWeeklyPeriods", () => {
    it("returns nothing when no week has been swept", async () => {
      expect(await listWeeklyPeriods(db)).toEqual([])
    })

    it("lists the weeks that have rows, newest first", async () => {
      const repoId = await seedRepo()
      await db.insert(repoWeeklyStars).values([
        { repoId, year: 2026, week: 8, stars: 1 },
        { repoId, year: 2026, week: 10, stars: 3 },
        { repoId, year: 2025, week: 52, stars: 2 },
      ])

      expect(await listWeeklyPeriods(db)).toEqual([
        { year: 2026, week: 10 },
        { year: 2026, week: 8 },
        { year: 2025, week: 52 },
      ])
    })

    it("collapses a period several repositories share into one entry", async () => {
      const a = await seedRepo()
      const b = await seedRepo()
      await db.insert(repoWeeklyStars).values([
        { repoId: a, year: 2026, week: 10, stars: 1 },
        { repoId: b, year: 2026, week: 10, stars: 5 },
      ])

      expect(await listWeeklyPeriods(db)).toEqual([{ year: 2026, week: 10 }])
    })

    it("omits a week that was never swept", async () => {
      const repoId = await seedRepo()
      await db
        .insert(repoWeeklyStars)
        .values({ repoId, year: 2026, week: 10, stars: 1 })

      const weeks = await listWeeklyPeriods(db)

      // Week 11 exists in the calendar but has no rows, so offering it would
      // render an empty ranking that reads like data loss.
      expect(weeks).not.toContainEqual({ year: 2026, week: 11 })
    })

    it("honours the limit", async () => {
      const repoId = await seedRepo()
      await db.insert(repoWeeklyStars).values([
        { repoId, year: 2026, week: 8, stars: 1 },
        { repoId, year: 2026, week: 9, stars: 1 },
        { repoId, year: 2026, week: 10, stars: 1 },
      ])

      expect(await listWeeklyPeriods(db, 2)).toEqual([
        { year: 2026, week: 10 },
        { year: 2026, week: 9 },
      ])
    })
  })

  describe("listMonthlyPeriods", () => {
    it("returns nothing when no month has been recorded", async () => {
      expect(await listMonthlyPeriods(db)).toEqual([])
    })

    it("reads the months out of the snapshot jsonb, newest first", async () => {
      const repoId = await seedRepo()
      for (const [year, month, stars] of [
        [2025, 11, 1],
        [2026, 2, 4],
        [2026, 1, 3],
      ] as const) {
        await recordMonth(db, repoId, { year, month }, { stars })
      }

      expect(await listMonthlyPeriods(db)).toEqual([
        { year: 2026, month: 2 },
        { year: 2026, month: 1 },
        { year: 2025, month: 11 },
      ])
    })

    it("collapses a month several repositories share into one entry", async () => {
      const a = await seedRepo()
      const b = await seedRepo()
      await recordMonth(db, a, { year: 2026, month: 1 }, { stars: 1 })
      await recordMonth(db, b, { year: 2026, month: 1 }, { stars: 9 })

      expect(await listMonthlyPeriods(db)).toEqual([{ year: 2026, month: 1 }])
    })

    it("spans the year boundary, which is the case a naive lookup misses", async () => {
      // January's predecessor is the previous December, which lives on a
      // different snapshot row, so the expansion has to see both.
      const repoId = await seedRepo()
      await recordMonth(db, repoId, { year: 2025, month: 12 }, { stars: 2 })
      await recordMonth(db, repoId, { year: 2026, month: 1 }, { stars: 5 })

      expect(await listMonthlyPeriods(db)).toEqual([
        { year: 2026, month: 1 },
        { year: 2025, month: 12 },
      ])
    })

    it("ignores a repository with no months recorded", async () => {
      // Two repositories exist but only one has any month rows, so the
      // expansion has to skip the empty one rather than emitting a null month.
      const withMonths = await seedRepo()
      await seedRepo()
      await recordMonth(db, withMonths, { year: 2026, month: 1 }, { stars: 1 })

      expect(await listMonthlyPeriods(db)).toEqual([{ year: 2026, month: 1 }])
    })
  })
})
