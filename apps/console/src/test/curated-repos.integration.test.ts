/**
 * Integration tests for the collected-versus-curated boundary.
 *
 * The console distinguishes a repository that has been *collected* from one that
 * has been *published*: the scheduled sweep refreshes metadata for both, but
 * deep-refreshes, star-sweeps and derives authors only from the second. Both
 * halves of that split are database behaviour — an inner join drops a row, a
 * left join keeps it — so a mocked query builder would assert nothing about the
 * thing under test.
 *
 * The suite is skipped unless `CONSOLE_DATABASE_URL` is set, so `pnpm test`
 * still passes with no database available.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { pool, db } from "@/db/client"
import { projects, repos } from "@/db/schema"
import {
  listAllRepos,
  listCuratedRepos,
  listReposByOwner,
  upsertRepo,
} from "@/lib/github/service/repo"
import { createProject, deleteProject } from "@/lib/github/service/project"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function info(fullName: string, overrides: Partial<RepoInfo> = {}): RepoInfo {
  const [owner = "", name = ""] = fullName.split("/")
  return {
    name,
    fullName,
    owner,
    ownerId: 1000 + owner.length,
    description: `${fullName} description`,
    // Empty strings rather than nulls: these are the shapes the GraphQL query
    // produces for a repository that has none of them.
    homepage: "",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-01-02T03:04:05Z"),
    defaultBranch: "main",
    stars: 1_000,
    topics: [],
    archived: false,
    commitCount: 100,
    lastCommit: new Date("2026-01-01T00:00:00Z"),
    mentionableUsersCount: 10,
    watchersCount: 100,
    licenseSpdxId: "MIT",
    pullRequestsCount: 10,
    releasesCount: 10,
    languages: [],
    forks: 100,
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

/** The name GitHub addresses a stored repository by, which is not a column. */
function fullName(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`
}

/** Publishes a repository, which is what makes it curated. */
async function publish(fullName: string, name: string) {
  const repo = await upsertRepo(db, info(fullName))
  const project = await createProject(db, {
    repoId: repo.id,
    name,
    owner: fullName.split("/")[0] ?? "",
    slug: `${fullName.replace("/", "-")}-${name}`,
  })
  return { repo, project }
}

describe.skipIf(!hasDatabase)("collected versus curated (integration)", () => {
  beforeAll(async () => {
    await db.delete(projects)
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(projects)
    await db.delete(repos)
  })

  afterAll(async () => {
    await db.delete(projects)
    await db.delete(repos)
    await pool.end()
  })

  it("counts a collected repository as stored but not curated", async () => {
    await upsertRepo(db, info("acme/widget"))

    // This is the pair of facts the sweep branches on: the repository is pulled
    // in so the list stays current, and it is absent from the curated set so
    // nothing is derived from it.
    expect((await listAllRepos(db)).map(fullName)).toEqual(["acme/widget"])
    expect(await listCuratedRepos(db)).toEqual([])
  })

  it("counts a published repository as curated", async () => {
    const { repo } = await publish("acme/widget", "Widget")

    const curated = await listCuratedRepos(db)

    expect(curated.map((entry) => entry.id)).toEqual([repo.id])
  })

  it("returns a repository once when it publishes several projects", async () => {
    const { repo } = await publish("acme/widget", "Widget")
    await createProject(db, {
      repoId: repo.id,
      name: "Widget CLI",
      owner: "acme",
      slug: "acme-widget-cli",
    })

    // The join emits one row per project. A duplicate here would deep-refresh
    // the same repository twice per run and report inflated counts.
    const curated = await listCuratedRepos(db)

    expect(curated).toHaveLength(1)
    expect(curated[0]?.id).toBe(repo.id)
  })

  it("drops a repository from the curated set once its last project is gone", async () => {
    const { repo, project } = await publish("acme/widget", "Widget")
    await deleteProject(db, project.id)

    expect(await listCuratedRepos(db)).toEqual([])
    // Still stored: withdrawing a publication is not the same as forgetting the
    // repository, and the user's list should keep showing it.
    expect((await listAllRepos(db)).map((entry) => entry.id)).toEqual([repo.id])
  })

  it("keeps a repository curated while any of its projects remains", async () => {
    const { repo } = await publish("acme/widget", "Widget")
    const second = await createProject(db, {
      repoId: repo.id,
      name: "Widget CLI",
      owner: "acme",
      slug: "acme-widget-cli",
    })

    await deleteProject(db, second.id)

    expect((await listCuratedRepos(db)).map((entry) => entry.id)).toEqual([
      repo.id,
    ])
  })

  it("gives an author only the projects of curated repositories", async () => {
    // One owner with two repositories: one published, one only collected. An
    // author page is built from published projects, so the collected repository
    // must not appear in the set at all rather than appearing with no projects.
    const { repo: published } = await publish("acme/widget", "Widget")
    const collected = await upsertRepo(db, info("acme/gadget"))

    const owners = await listReposByOwner(db)

    expect(owners).toHaveLength(1)
    expect(owners[0]?.owner).toBe("acme")
    expect(owners[0]?.repos).toEqual([
      { id: published.id, projectIds: [expect.any(String)] },
    ])
    expect(owners[0]?.repos.map((repo) => repo.id)).not.toContain(collected.id)
  })

  it("reports every project of a repository against one author", async () => {
    const { repo } = await publish("acme/widget", "Widget")
    const second = await createProject(db, {
      repoId: repo.id,
      name: "Widget CLI",
      owner: "acme",
      slug: "acme-widget-cli",
    })

    const owners = await listReposByOwner(db)

    expect(owners[0]?.repos).toHaveLength(1)
    expect(owners[0]?.repos[0]?.projectIds.sort()).toEqual(
      expect.arrayContaining([second.id])
    )
    expect(owners[0]?.repos[0]?.projectIds).toHaveLength(2)
    expect(owners[0]?.repos[0]?.id).toBe(repo.id)
  })

  it("creates no author for an owner whose repositories are all collected", async () => {
    await upsertRepo(db, info("acme/widget"))
    await upsertRepo(db, info("acme/gadget"))

    // The owner of nothing published has no author page, so the sweep must not
    // hand the directory a byline with an empty project set.
    expect(await listReposByOwner(db)).toEqual([])
  })
})
