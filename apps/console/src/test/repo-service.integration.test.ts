/**
 * Integration tests for the repository service.
 *
 * These run against a real PostgreSQL instance because the behaviour under
 * test is largely database behaviour: the `onConflictDoUpdate` conflict
 * target, the column defaults, and the rule that a partial update must not
 * clear columns it does not name. A mocked query builder would assert
 * nothing about any of that.
 *
 * The suite is skipped unless `CONSOLE_DATABASE_URL` is set, so
 * `pnpm test` still passes with no database available.
 */
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pool, db } from "@/db/client"
import { repos } from "@/db/schema"
import {
  curateRepo,
  getRepoByFullName,
  getReposByFullNames,
  setContributorCount,
  setIconUrls,
  setReadme,
  setTranslations,
  upsertRepo,
} from "@/lib/github/service/repo"
import type { RepoInfo } from "@/lib/github/repo-info-query"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function info(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    name: "next.js",
    fullName: "vercel/next.js",
    owner: "vercel",
    ownerId: 14_985_020,
    description: "The React Framework",
    homepage: "https://nextjs.org",
    createdAt: new Date("2016-10-25T21:15:00Z"),
    pushedAt: new Date("2026-01-02T03:04:05Z"),
    defaultBranch: "main",
    stars: 130_000,
    topics: ["react", "nextjs"],
    archived: false,
    commitCount: 21_000,
    lastCommit: new Date("2026-01-01T00:00:00Z"),
    mentionableUsersCount: 3_000,
    watchersCount: 28_000,
    licenseSpdxId: "MIT",
    pullRequestsCount: 4_000,
    releasesCount: 400,
    languages: ["TypeScript", "JavaScript"],
    forks: 27_000,
    openGraphImageUrl: "https://og.example/next.png",
    usesCustomOpenGraphImage: true,
    latestReleaseName: "Next.js 15",
    latestReleaseTagName: "v15.0.0",
    latestReleasePublishedAt: new Date("2025-10-21T12:00:00Z"),
    latestReleaseUrl: "https://github.com/vercel/next.js/releases/tag/v15.0.0",
    latestReleaseDescription: "Release notes",
    ...overrides,
  }
}

describe.skipIf(!hasDatabase)("repo service (integration)", () => {
  beforeAll(async () => {
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  it("inserts a new repository and stamps addedAt", async () => {
    const row = await upsertRepo(db, info())

    expect(row.id).toBeTruthy()
    expect(row.addedAt).toBeInstanceOf(Date)
    expect(row.stars).toBe(130_000)
    expect(row.topics).toEqual(["react", "nextjs"])
  })

  it("updates in place on the second call rather than inserting a duplicate", async () => {
    const first = await upsertRepo(db, info())
    const second = await upsertRepo(
      db,
      info({ stars: 135_000, description: "The React Framework, updated" })
    )

    expect(second.id).toBe(first.id)
    expect(second.stars).toBe(135_000)
    expect(second.description).toBe("The React Framework, updated")

    const { rows } = await db.execute(
      "select count(*)::int as count from repos where owner = 'vercel' and name = 'next.js'"
    )
    expect(Number((rows[0] as { count: number }).count)).toBe(1)
  })

  it("keeps addedAt fixed across refreshes", async () => {
    const first = await upsertRepo(db, info())
    const original = first.addedAt.getTime()

    // A clock that has moved on must not be reflected in addedAt.
    const second = await upsertRepo(db, info({ stars: 140_000 }))

    expect(second.addedAt.getTime()).toBe(original)
  })

  it("does not clobber fields owned by other tasks", async () => {
    const row = await upsertRepo(db, info())
    await setReadme(db, row.id, "# Next.js")
    await setTranslations(db, row.id, {
      readmeContentZh: "# Next.js（中文）",
      descriptionZh: "React 框架",
    })
    await setIconUrls(db, row.id, {
      iconUrl: "https://oss/icon.png",
      openGraphImageOssUrl: "https://oss/og.png",
    })

    // A routine stats refresh must leave all of that intact.
    await upsertRepo(db, info({ stars: 145_000, description: "changed" }))

    const stored = await getRepoByFullName(db, "vercel/next.js")
    expect(stored?.readmeContent).toBe("# Next.js")
    expect(stored?.readmeContentZh).toBe("# Next.js（中文）")
    expect(stored?.descriptionZh).toBe("React 框架")
    expect(stored?.iconUrl).toBe("https://oss/icon.png")
    expect(stored?.openGraphImageOssUrl).toBe("https://oss/og.png")
    expect(stored?.description).toBe("changed")
  })

  it("preserves stored counters when a degraded fetch reports zeros", async () => {
    const row = await upsertRepo(db, info())
    const before = await getRepoByFullName(db, "vercel/next.js")
    expect(before?.stars).toBe(130_000)

    // Tiers two and three of the client fallback return zeros for counters
    // they never read.
    await upsertRepo(
      db,
      info({
        stars: 0,
        forks: 0,
        watchersCount: 0,
        commitCount: 0,
        releasesCount: 0,
        topics: [],
        languages: [],
      })
    )

    const after = await getRepoByFullName(db, "vercel/next.js")
    expect(after?.stars).toBe(130_000)
    expect(after?.forks).toBe(27_000)
    expect(after?.watchersCount).toBe(28_000)
    expect(after?.commitCount).toBe(21_000)
    expect(after?.releasesCount).toBe(400)
    expect(after?.id).toBe(row.id)
  })

  it("stores contributor count independently of the metadata refresh", async () => {
    const row = await upsertRepo(db, info())
    await setContributorCount(db, row.id, 4321)

    await upsertRepo(db, info({ stars: 150_000 }))
    const stored = await getRepoByFullName(db, "vercel/next.js")

    expect(stored?.contributorCount).toBe(4321)
  })

  it("does not confuse a star count for a contributor count", async () => {
    // Regression guard: an earlier version read contributorCount from the
    // wrong key and wrote the star count into it. Uses its own row because
    // the test above deliberately set a contributor count elsewhere. The
    // conflict target is (owner, name), so both have to change.
    await upsertRepo(
      db,
      info({
        owner: "contributor-test",
        name: "thing",
        fullName: "contributor-test/thing",
      })
    )
    const stored = await getRepoByFullName(db, "contributor-test/thing")
    expect(stored).toBeDefined()

    // node-postgres surfaces a SQL NULL as undefined rather than null, so
    // the check is written as "nullish" rather than against null.
    expect(stored?.contributorCount ?? null).toBeNull()
    expect(stored?.contributorCount).not.toBe(stored?.stars)
    expect(stored?.stars).toBe(130_000)
  })

  it("keeps repositories with the same name under different owners apart", async () => {
    await upsertRepo(db, info())
    await upsertRepo(
      db,
      info({ owner: "someone-else", fullName: "someone-else/next.js" })
    )

    const byName = await getReposByFullNames(db, [
      "vercel/next.js",
      "someone-else/next.js",
    ])

    expect(byName.size).toBe(2)
    expect(byName.get("vercel/next.js")?.owner).toBe("vercel")
    expect(byName.get("someone-else/next.js")?.owner).toBe("someone-else")
  })

  it("returns only the repositories it was asked for", async () => {
    const found = await getReposByFullNames(db, [
      "vercel/next.js",
      "not/present",
    ])

    expect(found.has("vercel/next.js")).toBe(true)
    expect(found.has("not/present")).toBe(false)
  })

  it("returns nothing for an empty lookup", async () => {
    expect((await getReposByFullNames(db, [])).size).toBe(0)
  })

  it("returns undefined for a repository that does not exist", async () => {
    expect(await getRepoByFullName(db, "nobody/nothing")).toBeUndefined()
  })

  it("ignores a malformed full name", async () => {
    expect(await getRepoByFullName(db, "just-a-name")).toBeUndefined()
  })

  it("can delete a repository", async () => {
    const row = await upsertRepo(
      db,
      info({
        owner: "cascade-test",
        name: "thing",
        fullName: "cascade-test/thing",
      })
    )
    expect(await getRepoByFullName(db, "cascade-test/thing")).toBeDefined()

    await db.delete(repos).where(eq(repos.id, row.id))

    expect(await getRepoByFullName(db, "cascade-test/thing")).toBeUndefined()
  })

  it("leaves a hand-edited description alone on the next refresh", async () => {
    const row = await upsertRepo(
      db,
      info({
        owner: "override-test",
        name: "kept",
        fullName: "override-test/kept",
      })
    )
    await curateRepo(db, row.id, { description: "Hand-written" })

    await upsertRepo(
      db,
      info({
        owner: "override-test",
        name: "kept",
        fullName: "override-test/kept",
        description: "What GitHub says",
      })
    )

    const stored = await getRepoByFullName(db, "override-test/kept")
    expect(stored?.description).toBe("Hand-written")
    expect(stored?.overrideDescription).toBe(true)
  })

  it("does not raise the override flag for a value that did not change", async () => {
    // Saving the editor without touching a field must not detach it from
    // GitHub forever. The service compares against the stored row, so it is
    // safe regardless of how the form submits.
    const row = await upsertRepo(
      db,
      info({
        owner: "override-test",
        name: "unchanged",
        fullName: "override-test/unchanged",
      })
    )
    await curateRepo(db, row.id, { description: "The React Framework" })

    const stored = await getRepoByFullName(db, "override-test/unchanged")
    expect(stored?.overrideDescription ?? null).toBeNull()

    // And because the flag is clear, the next refresh still writes GitHub's.
    await upsertRepo(
      db,
      info({
        owner: "override-test",
        name: "unchanged",
        fullName: "override-test/unchanged",
        description: "A newer description",
      })
    )
    expect(
      (await getRepoByFullName(db, "override-test/unchanged"))?.description
    ).toBe("A newer description")
  })

  it("hands a field back to GitHub when the override is cleared", async () => {
    const row = await upsertRepo(
      db,
      info({
        owner: "override-test",
        name: "released",
        fullName: "override-test/released",
      })
    )
    await curateRepo(db, row.id, { description: "Hand-written" })
    await curateRepo(db, row.id, { overrideDescription: false })

    await upsertRepo(
      db,
      info({
        owner: "override-test",
        name: "released",
        fullName: "override-test/released",
        description: "GitHub's again",
      })
    )

    const stored = await getRepoByFullName(db, "override-test/released")
    expect(stored?.description).toBe("GitHub's again")
    // Explicitly false rather than absent: clearing is a write, not a delete.
    expect(stored?.overrideDescription).toBe(false)
  })
})
