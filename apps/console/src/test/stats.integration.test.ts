/**
 * Integration tests for the stats tables.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set. What is under test is the part
 * that a type checker cannot see and a unit test cannot reach: that two writers
 * sharing one row each keep their own columns, that a re-run converges instead of
 * compounding, and that a level and a change stay two different numbers all the
 * way into the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import {
  repoDailyStats,
  repoMonthlyStats,
  repoWeeklyStats,
  repos,
} from "@/db/schema"
import type { StarHistoryEntry } from "@/lib/github/client"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  clearStats,
  countStargazers,
  listDailyArrivals,
  listMonthlyStats,
  recordCurrentPeriods,
  recordStarHistory,
  recordStargazers,
} from "@/lib/github/service/stats"
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
    openIssuesCount: 0,
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
  const row = await upsertRepo(db, repoInfo(owner, name))
  await clearStats(db, row.id)
  return row
}

/** 2026-03-15T04:00Z is noon on a Sunday in Shanghai, inside ISO week 11. */
const NOW = new Date("2026-03-15T04:00:00Z")

/** A day inside NOW's week, at the instant the day opened in Shanghai. */
function DAY(dayOfMonth: number): Date {
  return new Date(Date.UTC(2026, 2, dayOfMonth, 16))
}

function monthly(repoId: string) {
  return db
    .select()
    .from(repoMonthlyStats)
    .where(eq(repoMonthlyStats.repoId, repoId))
}

function weekly(repoId: string) {
  return db
    .select()
    .from(repoWeeklyStats)
    .where(eq(repoWeeklyStats.repoId, repoId))
}

function daily(repoId: string) {
  return db
    .select()
    .from(repoDailyStats)
    .where(eq(repoDailyStats.repoId, repoId))
}

describe.skipIf(!hasDatabase)("stats service (integration)", () => {
  beforeAll(async () => {
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("recordCurrentPeriods", () => {
    it("writes the level into all three granularities", async () => {
      const repo = await seedRepo("stats", "levels")
      await recordCurrentPeriods(
        db,
        { id: repo.id, stars: 100, forks: 10, watchersCount: 5 },
        NOW
      )

      for (const rows of [
        await monthly(repo.id),
        await weekly(repo.id),
        await daily(repo.id),
      ]) {
        expect(rows).toHaveLength(1)
        expect(rows[0]?.totalStars).toBe(100)
        expect(rows[0]?.totalForks).toBe(10)
      }
    })

    it("keys the period on the Shanghai day, week and month", async () => {
      const repo = await seedRepo("stats", "periods")
      await recordCurrentPeriods(db, { id: repo.id, stars: 1 }, NOW)

      // Shanghai is UTC+8, so 2026-03-15T04:00Z is still the 15th there, ISO
      // week 11 opened on Monday the 9th, and March opened on the 1st.
      expect((await daily(repo.id))[0]?.period).toEqual(
        new Date("2026-03-14T16:00:00Z")
      )
      expect((await weekly(repo.id))[0]?.period).toEqual(
        new Date("2026-03-08T16:00:00Z")
      )
      expect((await monthly(repo.id))[0]?.period).toEqual(
        new Date("2026-02-28T16:00:00Z")
      )
    })

    it("leaves the change NULL when there is no previous period", async () => {
      // A repository appearing for the first time did not gain its whole star
      // count overnight, and reporting that would put every new repository at
      // the top of the trending list.
      const repo = await seedRepo("stats", "first")
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, NOW)

      expect((await daily(repo.id))[0]?.deltaStars).toBeNull()
      expect((await monthly(repo.id))[0]?.deltaStars).toBeNull()
    })

    it("records no change when a second run sees the same numbers", async () => {
      const repo = await seedRepo("stats", "rerun")
      const repoRow = { id: repo.id, stars: 100 }
      await recordCurrentPeriods(db, repoRow, NOW)
      await recordCurrentPeriods(db, repoRow, NOW)

      // Both runs are in the same period, so the second one compares against the
      // level it just wrote. Anything else double-counts the day.
      expect((await daily(repo.id))[0]?.deltaStars).toBe(0)
      expect((await daily(repo.id))[0]?.totalStars).toBe(100)
    })

    it("writes a level and a change that are different numbers", async () => {
      const repo = await seedRepo("stats", "level-vs-change")
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, NOW)
      await recordCurrentPeriods(
        db,
        { id: repo.id, stars: 105 },
        new Date("2026-03-16T04:00:00Z")
      )

      const rows = (await daily(repo.id)).sort(
        (a, b) => a.period.getTime() - b.period.getTime()
      )
      expect(rows).toHaveLength(2)
      expect(rows[1]?.totalStars).toBe(105)
      expect(rows[1]?.deltaStars).toBe(5)
    })

    it("records a negative change when stars are removed", async () => {
      const repo = await seedRepo("stats", "unstar")
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, NOW)
      await recordCurrentPeriods(
        db,
        { id: repo.id, stars: 90 },
        new Date("2026-03-16T04:00:00Z")
      )

      const rows = await daily(repo.id)
      expect(rows[0]?.deltaStars).toBe(-10)
    })

    it("keeps a counter NULL rather than claiming a zero", async () => {
      const repo = await seedRepo("stats", "nulls")
      await recordCurrentPeriods(db, { id: repo.id, stars: 10 }, NOW)
      await recordCurrentPeriods(
        db,
        { id: repo.id, stars: 12 },
        new Date("2026-03-16T04:00:00Z")
      )

      const rows = await daily(repo.id)
      // No package means no download count, which is not the same as none.
      expect(rows[0]?.totalDownloads).toBeNull()
      expect(rows[0]?.deltaDownloads).toBeNull()
      expect(rows[0]?.totalContributors).toBeNull()
    })

    it("writes the levels a history sweep left blank without erasing them", async () => {
      // The two writers share rows: the history owns `delta_new_stars` and the
      // sampler owns the rest. Whichever ran second must not blank the other.
      const repo = await seedRepo("stats", "two-writers")
      await recordStarHistory(
        db,
        repo.id,
        [entry(1771113600, 100, [1, 0, 0, 0, 0, 0, 0])],
        NOW
      )
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, NOW)

      const rows = await daily(repo.id)
      expect(rows[0]?.deltaNewStars).toBe(1)
      expect(rows[0]?.totalStars).toBe(100)
    })

    it("does not let the sampler's upsert clear the arrivals column", async () => {
      const repo = await seedRepo("stats", "two-writers-order")
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, NOW)
      await recordStarHistory(
        db,
        repo.id,
        [entry(1771113600, 100, [1, 0, 0, 0, 0, 0, 0])],
        NOW
      )

      const rows = await daily(repo.id)
      expect(rows[0]?.totalStars).toBe(100)
      expect(rows[0]?.deltaNewStars).toBe(1)
    })
  })

  describe("recordStarHistory", () => {
    /**
     * Two closed weeks and one that is still open at NOW.
     *
     * The totals deliberately do not add up to the arrivals: the jump between the
     * second and third bucket is what an unstar looks like, and it is the reason
     * `delta_stars` cannot be derived from `delta_new_stars`.
     */
    const history: StarHistoryEntry[] = [
      // Sunday 2026-02-15: Monday the 16th to Sunday the 22nd, all in February.
      { week: 1771113600, total: 200, days: [1, 1, 0, 0, 2, 0, 3] },
      // Sunday 2026-03-08: Monday the 9th to Sunday the 15th, all in March.
      { week: 1772928000, total: 260, days: [4, 0, 0, 10, 0, 6, 0] },
      // Sunday 2026-03-15: the week NOW falls inside.
      { week: 1773532800, total: 290, days: [5, 7, 0, 0, 0, 0, 0] },
    ]

    it("records arrivals per day with no level", async () => {
      const repo = await seedRepo("stats", "history-days")
      await recordStarHistory(db, repo.id, history, NOW)

      const rows = await daily(repo.id)
      // The history reports arrivals; a day's closing level would have to
      // account for unstars, which it cannot.
      expect(rows.every((row) => row.totalStars === null)).toBe(true)
      expect(rows.map((row) => row.deltaNewStars)).toEqual([
        1, 1, 2, 3, 4, 10, 6, 5, 7,
      ])
    })

    it("takes the level from the bucket total rather than summing arrivals", async () => {
      const repo = await seedRepo("stats", "history-levels")
      await recordStarHistory(db, repo.id, history, NOW)

      const rows = await weekly(repo.id)
      // 200 is GitHub's own number for the end of that week, not the 7 people
      // who arrived during it.
      expect(rows[0]?.totalStars).toBe(200)
      expect(rows[0]?.deltaNewStars).toBe(7)
    })

    it("leaves the first week without a change", async () => {
      const repo = await seedRepo("stats", "history-first-week")
      await recordStarHistory(db, repo.id, history, NOW)

      expect((await weekly(repo.id))[0]?.deltaStars).toBeNull()
    })

    it("reports the net change between consecutive weeks", async () => {
      const repo = await seedRepo("stats", "history-net")
      await recordStarHistory(db, repo.id, history, NOW)

      const rows = await weekly(repo.id)
      // 260 - 200 is 60, against 20 arrivals: the difference is stars that were
      // removed, and it has to stay visible.
      expect(rows[1]?.totalStars).toBe(260)
      expect(rows[1]?.deltaStars).toBe(60)
      expect(rows[1]?.deltaNewStars).toBe(20)
    })

    it("does not write a level into a week that is still open", async () => {
      const repo = await seedRepo("stats", "history-open")
      await recordStarHistory(db, repo.id, history, NOW)

      const open = (await weekly(repo.id))[2]
      // The daily sampler owns open periods, and it reads the repository's own
      // count, which is newer than the last complete bucket.
      expect(open?.totalStars).toBeNull()
      expect(open?.deltaStars).toBeNull()
      // The days that already happened are still facts.
      expect(open?.deltaNewStars).toBe(12)
    })

    it("does not write a level into an open month", async () => {
      const repo = await seedRepo("stats", "history-open-month")
      await recordStarHistory(db, repo.id, history, NOW)

      const rows = await monthly(repo.id)
      expect(rows[0]?.totalStars).toBe(200)
      expect(rows[0]?.deltaStars).toBeNull()
      expect(rows[1]?.totalStars).toBeNull()
      expect(rows[1]?.deltaNewStars).toBe(32)
    })

    it("is idempotent when the same history is recorded twice", async () => {
      // The bug this guards: a batch upsert that assembles its conflict values
      // in JS writes one row's numbers onto every other row, so a re-run would
      // put the newest week's arrivals on every date at once.
      const repo = await seedRepo("stats", "history-rerun")
      await recordStarHistory(db, repo.id, history, NOW)
      const first = (await daily(repo.id)).map((row) => row.deltaNewStars)

      await recordStarHistory(db, repo.id, history, NOW)

      expect((await daily(repo.id)).map((row) => row.deltaNewStars)).toEqual(
        first
      )
    })

    it("returns nothing for an empty history", async () => {
      const repo = await seedRepo("stats", "history-empty")
      expect(await recordStarHistory(db, repo.id, [], NOW)).toBe(0)
      expect(await recordStarHistory(db, repo.id, [entry(1, 0, [])], NOW)).toBe(
        0
      )
    })
  })

  describe("listDailyArrivals", () => {
    it("reads the newest days, not the first ones stored", async () => {
      const repo = await seedRepo("stats", "window")
      const rows = Array.from({ length: 10 }, (_, index) => ({
        period: DAY(index + 1),
        values: { changes: { newStars: index + 1 } },
      }))
      // The sampler's own day, on the first of the arrivals days rather than
      // after them: a row written past the arrivals run becomes the newest day
      // in the window and displaces the three the test is about.
      await recordCurrentPeriods(db, { id: repo.id, stars: 1 }, DAY(1))

      // Written through the batch path, which is what the history sweep uses.
      const { upsertStatsRows } = await import("@/lib/github/service/stats")
      await upsertStatsRows(db, repo.id, rows, "day")

      const window = await listDailyArrivals(db, repo.id, 3)
      expect(window.map((day) => day.stars)).toEqual([8, 9, 10])
    })

    it("falls back to the net movement when no sweep has measured arrivals", async () => {
      const repo = await seedRepo("stats", "net-fallback")
      // Three sampled days and no arrivals: the shape of every repository the
      // stargazer sweep has not reached, where `delta_new_stars` is NULL. The
      // first day has no stored prior, so nothing recorded how much it gained
      // and it stays a gap rather than becoming a zero.
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, DAY(1))
      await recordCurrentPeriods(db, { id: repo.id, stars: 130 }, DAY(2))
      await recordCurrentPeriods(db, { id: repo.id, stars: 155 }, DAY(3))

      const window = await listDailyArrivals(db, repo.id, 3)
      expect(window.map((day) => day.stars)).toEqual([undefined, 30, 25])
    })

    it("prefers arrivals over the net movement when both are recorded", async () => {
      const repo = await seedRepo("stats", "arrivals-win")
      await recordCurrentPeriods(db, { id: repo.id, stars: 100 }, DAY(1))
      await recordCurrentPeriods(db, { id: repo.id, stars: 110 }, DAY(2))

      const { upsertStatsRows } = await import("@/lib/github/service/stats")
      await upsertStatsRows(
        db,
        repo.id,
        [{ period: DAY(2), values: { changes: { newStars: 14 } } }],
        "day"
      )

      const window = await listDailyArrivals(db, repo.id, 2)
      expect(window.map((day) => day.stars)).toEqual([undefined, 14])
    })
  })

  describe("recordStargazers", () => {
    it("stores a stargazer once and keeps the later of two readings", async () => {
      const repo = await seedRepo("stats", "stargazers")
      await recordStargazers(db, repo.id, [
        { login: "ada", starredAt: new Date("2026-01-01T00:00:00Z") },
        { login: "grace", starredAt: new Date("2026-01-02T00:00:00Z") },
      ])

      // The same person read again later, and an upstream rename would be the
      // same situation: the newest timestamp wins rather than the last writer.
      await recordStargazers(db, repo.id, [
        { login: "ada", starredAt: new Date("2026-01-05T00:00:00Z") },
        { login: "ada", starredAt: new Date("2025-12-01T00:00:00Z") },
      ])

      expect(await countStargazers(db, repo.id)).toBe(2)
      const { latestStargazerAt } = await import("@/lib/github/service/stats")
      expect(await latestStargazerAt(db, repo.id)).toEqual(
        new Date("2026-01-05T00:00:00Z")
      )
    })

    it("writes nothing for an empty page", async () => {
      const repo = await seedRepo("stats", "stargazers-empty")
      expect(await recordStargazers(db, repo.id, [])).toBe(0)
    })
  })

  it("cascades stats away when the repository is deleted", async () => {
    const repo = await seedRepo("stats", "cascades")
    await recordCurrentPeriods(db, { id: repo.id, stars: 3 }, NOW)

    await db.delete(repos).where(eq(repos.id, repo.id))

    expect(await daily(repo.id)).toHaveLength(0)
    expect(await weekly(repo.id)).toHaveLength(0)
    expect(await monthly(repo.id)).toHaveLength(0)
  })

  it("lists a repository's monthly rows oldest first", async () => {
    const repo = await seedRepo("stats", "ordering")
    await recordCurrentPeriods(db, { id: repo.id, stars: 3 }, NOW)
    await recordCurrentPeriods(
      db,
      { id: repo.id, stars: 4 },
      new Date("2026-01-15T04:00:00Z")
    )

    const rows = await listMonthlyStats(db, repo.id)
    expect(rows.map((row) => row.period.getTime())).toEqual(
      [...rows].map((row) => row.period.getTime()).sort((a, b) => a - b)
    )
    expect(rows).toHaveLength(2)
  })
})

/** One weekly bucket, in the shape the client hands the service. */
function entry(week: number, total: number, days: number[]): StarHistoryEntry {
  return { week, total, days }
}
