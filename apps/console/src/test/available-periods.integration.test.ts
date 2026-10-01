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
import { repoMonthlyStats, repoWeeklyStats, repos } from "@/db/schema"
import {
  listMonthlyPeriods,
  listWeeklyPeriods,
} from "@/lib/github/service/available-periods"
import { upsertRepo } from "@/lib/github/service/repo"
import {
  periodFromMonth,
  periodFromWeek,
} from "@/lib/github/snapshot-dates"
import { upsertStatsRow } from "@/lib/github/service/stats"
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

async function seedRepo(): Promise<string> {
  const repo = await upsertRepo(db, info())
  return repo.id
}

describe.skipIf(!hasDatabase)("available ranking periods (integration)", () => {
  beforeEach(async () => {
    await db.delete(repoWeeklyStats)
    await db.delete(repoMonthlyStats)
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
      await weekRow(repoId, 2026, 8, 1)
      await weekRow(repoId, 2026, 10, 3)
      await weekRow(repoId, 2025, 52, 2)

      expect(await listWeeklyPeriods(db)).toEqual([
        { year: 2026, week: 10 },
        { year: 2026, week: 8 },
        { year: 2025, week: 52 },
      ])
    })

    it("collapses a period several repositories share into one entry", async () => {
      const a = await seedRepo()
      const b = await seedRepo()
      await weekRow(a, 2026, 10, 1)
      await weekRow(b, 2026, 10, 5)

      expect(await listWeeklyPeriods(db)).toEqual([{ year: 2026, week: 10 }])
    })

    it("omits a week that was never swept", async () => {
      const repoId = await seedRepo()
      await weekRow(repoId, 2026, 10, 1)

      const weeks = await listWeeklyPeriods(db)

      // Week 11 exists in the calendar but has no rows, so offering it would
      // render an empty ranking that reads like data loss.
      expect(weeks).not.toContainEqual({ year: 2026, week: 11 })
    })

    it("honours the limit", async () => {
      const repoId = await seedRepo()
      await weekRow(repoId, 2026, 8, 1)
      await weekRow(repoId, 2026, 9, 1)
      await weekRow(repoId, 2026, 10, 1)

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

    it("reads the months out of the stats rows, newest first", async () => {
      const repoId = await seedRepo()
      for (const [year, month, stars] of [
        [2025, 11, 1],
        [2026, 2, 4],
        [2026, 1, 3],
      ] as const) {
        await monthRow(repoId, year, month, stars)
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
      await monthRow(a, 2026, 1, 1)
      await monthRow(b, 2026, 1, 9)

      expect(await listMonthlyPeriods(db)).toEqual([{ year: 2026, month: 1 }])
    })

    it("spans the year boundary, which is the case a naive lookup misses", async () => {
      // Each month is its own row now, so this no longer crosses a year in a
      // single query — it is here because the *ordering* still has to.
      const repoId = await seedRepo()
      await monthRow(repoId, 2025, 12, 2)
      await monthRow(repoId, 2026, 1, 5)

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
      await monthRow(withMonths, 2026, 1, 1)

      expect(await listMonthlyPeriods(db)).toEqual([{ year: 2026, month: 1 }])
    })
  })
})

/**
 * One weekly row, filed on the instant Shanghai's ISO week opened.
 *
 * Written through the service rather than inserted directly so the fixture
 * cannot drift from the period definition the app writes with — a test that
 * hard-codes the instant would keep passing after the zone or the weekday rule
 * changed.
 */
async function weekRow(
  repoId: string,
  year: number,
  weekNumber: number,
  stars: number
) {
  await upsertStatsRow(db, "week", repoId, periodFromWeek({ year, week: weekNumber }), {
    levels: { stars },
  })
}

/** One monthly row, filed the same way. */
async function monthRow(
  repoId: string,
  year: number,
  monthNumber: number,
  stars: number
) {
  await upsertStatsRow(
    db,
    "month",
    repoId,
    periodFromMonth({ year, month: monthNumber }),
    { levels: { stars } }
  )
}
