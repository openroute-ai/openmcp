import { describe, expect, it } from "vitest"
import { toRepoRow, toRepoUpdate } from "@/lib/github/service/repo"
import type { RepoInfo } from "@/lib/github/repo-info-query"

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
    topics: ["react"],
    archived: false,
    commitCount: 21_000,
    lastCommit: new Date("2026-01-01T00:00:00Z"),
    mentionableUsersCount: 3_000,
    watchersCount: 28_000,
    licenseSpdxId: "MIT",
    pullRequestsCount: 4_000,
    openIssuesCount: 4_000,
    releasesCount: 400,
    languages: ["TypeScript"],
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

/** A `RepoInfo` as the client's reduced fallback tiers produce it. */
function degraded(): RepoInfo {
  return info({
    stars: 0,
    forks: 0,
    watchersCount: 0,
    mentionableUsersCount: 0,
    pullRequestsCount: 0,
    openIssuesCount: 0,
    releasesCount: 0,
    commitCount: 0,
    languages: [],
    topics: [],
    licenseSpdxId: "",
  })
}

describe("toRepoRow", () => {
  it("carries every GitHub-derived field", () => {
    const row = toRepoRow(info())

    expect(row.name).toBe("next.js")
    expect(row.owner).toBe("vercel")
    expect(row.ownerId).toBe(14_985_020)
    expect(row.stars).toBe(130_000)
    expect(row.forks).toBe(27_000)
    expect(row.topics).toEqual(["react"])
    expect(row.languages).toEqual(["TypeScript"])
    expect(row.pushedAt).toEqual(new Date("2026-01-02T03:04:05Z"))
    expect(row.openIssuesCount).toBe(4_000)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it("does not set addedAt, so the column default marks first sighting", () => {
    expect(toRepoRow(info())).not.toHaveProperty("addedAt")
  })
})

describe("toRepoUpdate", () => {
  it("updates the descriptive fields a stats refresh owns", () => {
    const update = toRepoUpdate(info())

    expect(update.description).toBe("The React Framework")
    expect(update.defaultBranch).toBe("main")
    expect(update.pushedAt).toEqual(new Date("2026-01-02T03:04:05Z"))
    expect(update.updatedAt).toBeInstanceOf(Date)
  })

  it("never touches the fields owned by the README, icon and translation tasks", () => {
    // A routine stats refresh must not be able to wipe work done by other
    // tasks, so these keys are absent from the update payload entirely.
    const update = toRepoUpdate(info())

    for (const key of [
      "readmeContent",
      "readmeContentZh",
      "descriptionZh",
      "latestReleaseDescriptionZh",
      "iconUrl",
      "openGraphImageOssUrl",
      "contributorCount",
      "addedAt",
      "id",
    ]) {
      expect(update).not.toHaveProperty(key)
    }
  })

  it("keeps stored counters when a degraded fetch reports zeros", () => {
    // This is the case that motivated the rule: tiers two and three of the
    // client fallback return a RepoInfo whose counts were never read, so
    // writing them would replace good data with zeros.
    const update = toRepoUpdate(degraded())

    expect(update).not.toHaveProperty("stars")
    expect(update).not.toHaveProperty("forks")
    expect(update).not.toHaveProperty("watchersCount")
    expect(update).not.toHaveProperty("commitCount")
    expect(update).not.toHaveProperty("pullRequestsCount")
    expect(update).not.toHaveProperty("releasesCount")
    expect(update).not.toHaveProperty("mentionableUsersCount")
    expect(update).not.toHaveProperty("openIssuesCount")
  })

  it("keeps the stored open issue count when a repository closes its last issue", () => {
    // Unlike the counters above, zero here is a real value rather than a signal
    // that the count was never read, and a tracker does reach zero and stay
    // there. Either way the row keeps its old count, because the only thing a
    // zero can justify writing is a measurement — and a degraded tier is not
    // one — so this asserts the rule rather than blessing the stale value.
    expect(toRepoUpdate(info({ openIssuesCount: 0 }))).not.toHaveProperty(
      "openIssuesCount"
    )
    expect(toRepoUpdate(info({ openIssuesCount: 12 })).openIssuesCount).toBe(12)
  })

  it("still writes a real count", () => {
    expect(toRepoUpdate(degraded()).stars).toBeUndefined()
    expect(toRepoUpdate(info()).stars).toBe(130_000)
  })

  it("keeps the identity fields in sync so a rename is recorded", () => {
    const update = toRepoUpdate(info({ name: "next.js-rs" }))
    expect(update.name).toBe("next.js-rs")
  })

  it("does not copy one counter onto another", () => {
    // Regression guard: an earlier version read contributorCount off the
    // wrong key and wrote the star count into it.
    const update = toRepoUpdate(degraded())
    expect(update).not.toHaveProperty("contributorCount")
  })
})

describe("toRepoUpdate with overrides", () => {
  it("does not overwrite description or homepage when overridden", () => {
    const base = info({ description: "New", homepage: "https://new.com" })
    const update = toRepoUpdate(base, { description: true, homepage: true })

    expect(update).not.toHaveProperty("description")
    expect(update).not.toHaveProperty("homepage")
  })
})
