/**
 * Integration tests for snapshot persistence.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set. The behaviour under test is
 * the read-modify-write of a year row: two collectors must be able to add
 * different fields to the same month without either losing its data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import { repoWeeklyStars, repos } from "@/db/schema"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  computeMonthlyTrend,
  flattenMonths,
  getSnapshot,
  isConsecutiveMonth,
  listSnapshots,
  listSnapshottedRepoIds,
  monthAt,
  recordMonth,
  recordStarsFromStargazers,
  recordWeeklyStarsFromStargazers,
} from "@/lib/github/service/snapshot"
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

describe.skipIf(!hasDatabase)("snapshot service (integration)", () => {
  beforeAll(async () => {
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("isConsecutiveMonth", () => {
    it("accepts the same year", () => {
      expect(
        isConsecutiveMonth({ year: 2026, month: 1 }, { year: 2026, month: 2 })
      ).toBe(true)
    })

    it("accepts December to January", () => {
      expect(
        isConsecutiveMonth({ year: 2025, month: 12 }, { year: 2026, month: 1 })
      ).toBe(true)
    })

    it("rejects a skipped month and a year jump", () => {
      expect(
        isConsecutiveMonth({ year: 2026, month: 1 }, { year: 2026, month: 3 })
      ).toBe(false)
      expect(
        isConsecutiveMonth(
          { year: 2026, month: 12 },
          { year: 2027, month: 1 }
        ) === false
      ).toBe(false)
      expect(
        isConsecutiveMonth({ year: 2024, month: 12 }, { year: 2026, month: 1 })
      ).toBe(false)
    })
  })

  it("creates the year row on first write", async () => {
    const repo = await seedRepo("snap", "new")
    await recordMonth(db, repo.id, { year: 2026, month: 3 }, { stars: 42 })

    const row = await getSnapshot(db, repo.id, 2026)
    expect(row?.months).toEqual([{ year: 2026, month: 3, stars: 42 }])
  })

  it("merges into the existing year row", async () => {
    const repo = await seedRepo("snap", "merge")
    await recordMonth(db, repo.id, { year: 2026, month: 1 }, { stars: 10 })
    await recordMonth(db, repo.id, { year: 2026, month: 2 }, { stars: 20 })

    const row = await getSnapshot(db, repo.id, 2026)
    expect(row?.months).toHaveLength(2)
    expect(row?.months?.map((m) => m.stars)).toEqual([10, 20])
  })

  it("keeps stars and downloads recorded by different collectors", async () => {
    const repo = await seedRepo("snap", "collectors")
    await recordMonth(
      db,
      repo.id,
      { year: 2026, month: 5 },
      {
        totalDownloads: 5_000,
      }
    )
    await recordMonth(db, repo.id, { year: 2026, month: 5 }, { stars: 700 })
    await recordMonth(
      db,
      repo.id,
      { year: 2026, month: 5 },
      {
        totalContributors: 12,
      }
    )

    const row = await getSnapshot(db, repo.id, 2026)
    expect(monthAt(row!, { year: 2026, month: 5 })).toEqual({
      year: 2026,
      month: 5,
      stars: 700,
      totalDownloads: 5_000,
      totalContributors: 12,
    })
  })

  it("does not lose a field when concurrent collectors write the same month", async () => {
    // The read-modify-write lives in one transaction precisely so that two
    // collectors racing on the same year cannot clobber each other.
    const repo = await seedRepo("snap", "race")
    await Promise.all([
      recordMonth(db, repo.id, { year: 2026, month: 7 }, { stars: 1 }),
      recordMonth(
        db,
        repo.id,
        { year: 2026, month: 7 },
        {
          totalDownloads: 2,
        }
      ),
      recordMonth(
        db,
        repo.id,
        { year: 2026, month: 7 },
        {
          totalContributors: 3,
        }
      ),
    ])

    const month = monthAt((await getSnapshot(db, repo.id, 2026))!, {
      year: 2026,
      month: 7,
    })

    // Whichever order the transactions committed in, the fields that were
    // written must all be present.
    expect(month?.totalDownloads).toBe(2)
    expect(month?.totalContributors).toBe(3)
  })

  it("separates years into their own rows", async () => {
    const repo = await seedRepo("snap", "years")
    await recordMonth(db, repo.id, { year: 2025, month: 12 }, { stars: 5 })
    await recordMonth(db, repo.id, { year: 2026, month: 1 }, { stars: 9 })

    expect((await listSnapshots(db, repo.id)).map((r) => r.year)).toEqual([
      2025, 2026,
    ])
  })

  it("records a stargazer sweep as a running monthly total", async () => {
    const repo = await seedRepo("snap", "sweep")
    const months = await recordStarsFromStargazers(db, repo.id, [
      { starredAt: "2026-01-05T00:00:00Z" },
      { starredAt: "2026-01-20T00:00:00Z" },
      { starredAt: "2026-02-10T00:00:00Z" },
    ])

    expect(months).toBe(2)

    const history = flattenMonths(await listSnapshots(db, repo.id))
    expect(history.map((m) => m.stars)).toEqual([2, 3])
    expect(computeMonthlyTrend(history).map((t) => t.delta)).toEqual([
      undefined,
      1,
    ])
  })

  it("lists repositories that have history", async () => {
    const withHistory = await seedRepo("snap", "history")
    await seedRepo("snap", "nohistory")
    await recordMonth(
      db,
      withHistory.id,
      { year: 2026, month: 1 },
      {
        stars: 1,
      }
    )

    const ids = await listSnapshottedRepoIds(db)
    expect(ids).toContain(withHistory.id)
  })

  it("cascades a snapshot away when its repository is deleted", async () => {
    const repo = await seedRepo("snap", "cascades")
    await recordMonth(db, repo.id, { year: 2026, month: 1 }, { stars: 1 })

    const { eq } = await import("drizzle-orm")
    const { repos: reposTable } = await import("@/db/schema")
    await db.delete(reposTable).where(eq(reposTable.id, repo.id))

    expect(await listSnapshots(db, repo.id)).toHaveLength(0)
  })

  describe("weekly stargazer rows", () => {
    beforeEach(async () => {
      await db.delete(repoWeeklyStars)
    })

    it("fills the empty weeks between the first and last stargazer with zeros", async () => {
      const repo = await seedRepo("snap", "weekly-gap")
      const weeks = await recordWeeklyStarsFromStargazers(db, repo.id, [
        { starredAt: "2026-01-05T00:00:00Z" },
        { starredAt: "2026-03-02T00:00:00Z" },
      ])

      const rows = await db
        .select()
        .from(repoWeeklyStars)
        .where(eq(repoWeeklyStars.repoId, repo.id))

      const gap = rows.find((row) => row.year === 2026 && row.week === 8)
      expect(gap?.stars).toBe(0)
      // 2026-01-05 falls in ISO week 2 and 2026-03-02 in week 10, so the
      // stargazers straddle the empty weeks rather than sharing one.
      expect(
        rows.find((row) => row.year === 2026 && row.week === 2)?.stars
      ).toBe(1)
      expect(
        rows.find((row) => row.year === 2026 && row.week === 10)?.stars
      ).toBe(1)
      // More weeks than stargazers, because the empty ones are materialized.
      expect(rows).toHaveLength(weeks)
      expect(rows.length).toBeGreaterThan(2)
    })

    it("counts a 53-week ISO year across its full span", async () => {
      // 2020 has 53 ISO weeks: 1 January is a Wednesday leap year. A sweep
      // from early 2019 to late 2021 passes through it as an intermediate
      // year, which is exactly the case a weekday heuristic can get wrong.
      const repo = await seedRepo("snap", "leap")
      const weeks = await recordWeeklyStarsFromStargazers(db, repo.id, [
        { starredAt: "2019-01-02T00:00:00Z" },
        { starredAt: "2021-12-30T00:00:00Z" },
      ])

      const rows = await db
        .select()
        .from(repoWeeklyStars)
        .where(eq(repoWeeklyStars.repoId, repo.id))

      const in2020 = rows.filter((row) => row.year === 2020)
      expect(in2020).toHaveLength(53)
      expect(in2020.some((row) => row.week === 53)).toBe(true)
      expect(rows).toHaveLength(weeks)
      expect(rows.map((row) => `${row.year}-${row.week}`)).toContain("2020-53")
    })

    it("replaces the repository's rows rather than appending", async () => {
      const repo = await seedRepo("snap", "weekly-replace")
      await db.insert(repoWeeklyStars).values({
        repoId: repo.id,
        year: 2015,
        week: 1,
        stars: 999,
      })

      const weeks = await recordWeeklyStarsFromStargazers(db, repo.id, [
        { starredAt: "2026-01-05T00:00:00Z" },
      ])

      const rows = await db
        .select()
        .from(repoWeeklyStars)
        .where(eq(repoWeeklyStars.repoId, repo.id))

      // The stale 2015 row predates the sweep and must not survive it.
      expect(rows.every((row) => row.year === 2026)).toBe(true)
      expect(rows).toHaveLength(weeks)
      expect(rows.some((row) => row.year === 2015)).toBe(false)
    })
  })
})
