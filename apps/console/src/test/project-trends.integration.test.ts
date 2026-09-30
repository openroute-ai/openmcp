/**
 * Integration tests for the trend figures the project page charts.
 *
 * Skipped unless `CONSOLE_DATABASE_URL` is set, because the part that cannot
 * be checked from a fake is the read: the monthly totals live in a JSON column
 * on one row per year, and the weekly gains in their own table, so the figures
 * are only right if both are actually read back and joined the way the page
 * joins them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { projectSyncJobs, projects, repos } from "@/db/schema"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { lastNMonths, recordMonth } from "@/lib/github/service/snapshot"
import { createCaller } from "@/lib/trpc/root"
import { fakeAdminContext } from "./helpers/fakes"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function repoInfo(name: string): RepoInfo {
  return {
    name,
    fullName: `acme/${name}`,
    owner: "acme",
    ownerId: 1,
    description: "A thing",
    homepage: "https://example.com",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-01-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 100,
    topics: [],
    archived: false,
    commitCount: 1,
    lastCommit: new Date("2026-01-01T00:00:00Z"),
    mentionableUsersCount: 1,
    watchersCount: 100,
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
  }
}

async function seed(name: string) {
  const repo = await upsertRepo(db, repoInfo(name))
  const project = await createProject(db, {
    repoId: repo.id,
    name,
    owner: "acme",
    slug: `acme-${name}`,
    description: "A thing",
    type: "application",
  })
  // The repo id as well as the project id: the snapshot tables key on the
  // repository, so recording history needs it and the test needs to prove the
  // page found the right repository's rows.
  return { project, repoId: repo.id }
}

/** The number of bars a chart draws, read off the response rather than assumed. */
const CHART_MONTHS = 12
const CHART_WEEKS = 12

const caller = createCaller(fakeAdminContext(db))

describe.skipIf(!hasDatabase)("project trends (integration)", () => {
  beforeAll(async () => {
    await db.delete(projectSyncJobs)
    await db.delete(projects)
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  it("reads a full window of bars for a repository with history", async () => {
    const { project, repoId } = await seed("trends-full")
    // The trailing months, taken from the service that builds the window rather
    // than hardcoded: the chart window is relative to the current month, so a
    // fixture pinned to fixed dates would drift out of the window and assert
    // over an empty list as the calendar moved on.
    const trailing = lastNMonths(CHART_MONTHS, new Date()).slice(-3)

    // Written through the service so the JSON column has the shape the app
    // writes, and so the read-modify-write of a shared year row is exercised.
    for (const [index, yearMonth] of trailing.entries()) {
      await recordMonth(db, repoId, yearMonth, { stars: (index + 1) * 10 })
    }

    const trends = (await caller.projects.byId({ id: project.id })).trends!

    expect(trends.bars).toHaveLength(CHART_MONTHS)
    expect(trends.weeks).toHaveLength(CHART_WEEKS)
    // The months that carry a total, identified by the months that were written
    // rather than by calendar arithmetic that would not survive a year boundary.
    const recorded = trends.bars.filter((bar) =>
      trailing.some(
        (yearMonth) =>
          yearMonth.year === bar.yearMonth.year &&
          yearMonth.month === bar.yearMonth.month
      )
    )
    expect(recorded.map((bar) => bar.total)).toEqual([10, 20, 30])
    expect(recorded[0]!.delta).toBeUndefined()
    expect(recorded[1]!.delta).toBe(10)
    expect(recorded[2]!.delta).toBe(10)
    expect(trends.periods.total).toBe(30)
    expect(trends.periods.month).toBe(10)
  })

  it("reports every figure unknown for a repository with no history", async () => {
    const { project } = await seed("trends-empty")
    const result = await caller.projects.byId({ id: project.id })
    const trends = result.trends!

    expect(trends.bars).toHaveLength(CHART_MONTHS)
    expect(trends.bars.every((bar) => bar.delta === undefined)).toBe(true)
    expect(trends.weeks.every((week) => week.stars === 0)).toBe(true)
    expect(trends.periods).toEqual({
      week: undefined,
      month: undefined,
      year: undefined,
      total: undefined,
    })
  })

  it("does not mix one repository's history into another's", async () => {
    const { project, repoId } = await seed("trends-noisy")
    const [latest] = lastNMonths(CHART_MONTHS, new Date()).slice(-1)
    await recordMonth(db, repoId, latest!, { stars: 9999 })

    const { project: quiet } = await seed("trends-quiet")
    const result = await caller.projects.byId({ id: quiet.id })
    // The neighbour has a thousand-fold larger total; a query that joined the
    // weekly or monthly table without a repo predicate would show it here.
    expect(result.trends!.periods.total).toBeUndefined()
    expect(project.id).not.toBe(quiet.id)
  })
})
