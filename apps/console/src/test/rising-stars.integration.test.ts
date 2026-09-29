/**
 * Integration tests for the Rising Stars report.
 *
 * The report is unusual among the outputs here: it is the only one computed
 * over a calendar year, from monthly running totals, and it both persists to
 * a table and is published as a JSON artefact. These tests pin the numbers
 * and the selection, using the same fixtures as the ranking tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { eq } from "drizzle-orm"
import {
  projects,
  projectsToTags,
  repos,
  risingStarCategories,
  risingStarProjects,
  snapshots,
  tags,
} from "@/db/schema"
import {
  buildRisingStarsForYear,
  defaultRisingStarCategories,
  getRisingStarCategories,
} from "@/lib/github/service/rising-stars"
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
    createdAt: new Date("2023-06-01T00:00:00Z"),
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
 * Records a full year of monthly running totals plus the closing month of the
 * year before, so every month has a predecessor and a measurable delta.
 *
 * A month's row is the running total at its close, so month `m` of `year`
 * ends at `first + growth * m` and December the year before — the value
 * January is compared against — is `first`.
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

async function attach(projectId: string, tagCode: string, excluded = false) {
  const row = await tag(tagCode, excluded)
  await db
    .insert(projectsToTags)
    .values({ projectId, tagId: row.id })
    .onConflictDoNothing()
  return row
}

describe.skipIf(!hasDatabase)("rising stars (integration)", () => {
  beforeAll(async () => {
    await db.delete(projectsToTags)
    await db.delete(risingStarProjects)
    await db.delete(risingStarCategories)
    await db.delete(snapshots)
    await db.delete(tags)
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(projectsToTags)
    await db.delete(risingStarProjects)
    await db.delete(risingStarCategories)
    await db.delete(snapshots)
    await db.delete(projects)
  })

  afterAll(async () => {
    await pool.end()
  })

  it("orders projects by the year's star delta", async () => {
    const fast = await seed()
    const slow = await seed()
    await recordYear(fast.repo.id, 2025, 2000, 100)
    await recordYear(slow.repo.id, 2025, 1000, 30)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    expect(report.projects[0]?.full_name).toBe(fast.fullName)
    expect(report.projects[0]?.delta).toBe(1200)
    // The count the year closed on: the first running total of 2026.
    expect(report.projects[0]?.stars).toBe(3300)
    expect(report.projects[1]?.full_name).toBe(slow.fullName)
    expect(report.projects[1]?.delta).toBe(360)
  })

  it("reports monthly growth, December first", async () => {
    const repo = await seed()
    await recordYear(repo.repo.id, 2025, 2000, 100)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    const monthly = report.projects[0]!.monthly
    expect(monthly).toHaveLength(12)
    // January is the last element, December the first.
    expect(monthly[0]).toBe(100)
    expect(monthly[11]).toBe(100)
  })

  it("leaves a month with no history as null, not zero", async () => {
    const repo = await seed()
    // Only the first half of the year, so the tail has nothing to report.
    await record(repo.repo.id, 2024, 12, 200)
    for (let month = 1; month <= 6; month++) {
      await record(repo.repo.id, 2025, month, 200 + month * 10)
    }
    await record(repo.repo.id, 2026, 1, 300)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    expect(report.projects[0]!.monthly[0]).toBeNull() // December
    expect(report.projects[0]!.monthly[11]).toBe(10) // January
  })

  it("skips a project that gained nothing over the year", async () => {
    const still = await seed()
    await recordYear(still.repo.id, 2025, 2000, 0)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    expect(report.count).toBe(0)
    expect(report.projects).toEqual([])
  })

  it("omits a repository with no snapshot for the year", async () => {
    const repo = await seed()
    // History only for 2024; 2025 is the target and the repo is no candidate.
    await recordYear(repo.repo.id, 2024, 1000, 100)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    expect(report.count).toBe(0)
  })

  it("omits hidden and deprecated projects", async () => {
    const active = await seed()
    const hidden = await seed({ status: "hidden" })
    const deprecated = await seed({ status: "deprecated" })
    await recordYear(active.repo.id, 2025, 1000, 100)
    await recordYear(hidden.repo.id, 2025, 1000, 900)
    await recordYear(deprecated.repo.id, 2025, 1000, 900)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    expect(report.projects.map((p) => p.full_name)).toEqual([active.fullName])
  })

  it("excludes an excluded-tag project from the overall bucket", async () => {
    const kept = await seed()
    const dropped = await seed()
    await recordYear(kept.repo.id, 2025, 1000, 100)
    await recordYear(dropped.repo.id, 2025, 1000, 900)
    await attach(dropped.project.id, "meta", true)

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    // The "all" bucket refuses the excluded tag and no default sub-category
    // asks for "meta", so the highest-growing project of the year is absent.
    expect(report.projects.map((p) => p.full_name)).toEqual([kept.fullName])
  })

  it("lists every tag the selected projects carry", async () => {
    const repo = await seed()
    await recordYear(repo.repo.id, 2025, 1000, 100)
    await attach(repo.project.id, "cli")
    await attach(repo.project.id, "css")

    const report = await buildRisingStarsForYear(
      db,
      2025,
      new Date("2026-01-15")
    )

    expect(report.tags.map((t) => t.code).sort()).toEqual(["cli", "css"])
    expect(report.projects[0]!.tags.sort()).toEqual(["cli", "css"])
  })

  it("seeds the category configuration for the year", async () => {
    const categories = await getRisingStarCategories(db, 2025)

    expect(categories.find((c) => c.key === "all")).toBeDefined()
    expect(categories).toEqual(defaultRisingStarCategories)
  })

  it("persists the selection and replaces stale rows on a later run", async () => {
    const first = await seed()
    const second = await seed()
    await recordYear(first.repo.id, 2025, 1000, 100)
    await recordYear(second.repo.id, 2025, 1000, 50)

    await buildRisingStarsForYear(db, 2025, new Date("2026-01-15"))

    const rows = await db
      .select()
      .from(risingStarProjects)
      .where(eq(risingStarProjects.year, 2025))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.fullName).sort()).toEqual(
      [first, second].map((s) => s.fullName).sort()
    )
    expect(rows.find((r) => r.fullName === first.fullName)?.position).toBe(1)
    expect(rows.find((r) => r.fullName === first.fullName)?.category).toBe(
      "all"
    )

    // A third repository appears; the stored selection is replaced, not
    // appended, so the two older rows are not joined by a stale one.
    const third = await seed()
    await recordYear(third.repo.id, 2025, 1000, 400)
    await buildRisingStarsForYear(db, 2025, new Date("2026-01-16"))

    const replaced = await db
      .select()
      .from(risingStarProjects)
      .where(eq(risingStarProjects.year, 2025))
    expect(replaced.map((r) => r.fullName).sort()).toEqual(
      [first, second, third].map((s) => s.fullName).sort()
    )
    expect(replaced.find((r) => r.fullName === third.fullName)?.position).toBe(
      1
    )
    expect(replaced.find((r) => r.fullName === third.fullName)?.starDelta).toBe(
      4800
    )
  })
})
