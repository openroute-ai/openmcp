import { describe, expect, it } from "vitest"
import {
  buildBatchRepoInfoQuery,
  chunk,
  extractRepoInfo,
  MAX_BATCH_SIZE,
} from "@/lib/github/repo-info-query"

function repositoryNode(overrides: Record<string, unknown> = {}) {
  return {
    name: "next.js",
    description: "The React Framework",
    homepageUrl: "https://nextjs.org",
    createdAt: "2016-10-25T21:15:00Z",
    pushedAt: "2026-01-02T03:04:05Z",
    isArchived: false,
    forkCount: 27_000,
    openGraphImageUrl: "https://og.example/next.png",
    usesCustomOpenGraphImage: true,
    owner: {
      login: "vercel",
      avatarUrl: "https://avatars.githubusercontent.com/u/14985020?v=4",
    },
    licenseInfo: { spdxId: "MIT" },
    stargazers: { totalCount: 130_000 },
    watchers: { totalCount: 28_000 },
    mentionableUsers: { totalCount: 3_000 },
    pullRequests: { totalCount: 4_000 },
    releases: { totalCount: 400 },
    repositoryTopics: {
      edges: [
        { node: { topic: { name: "react" } } },
        { node: { topic: { name: "nextjs" } } },
      ],
    },
    languages: {
      nodes: [{ name: "TypeScript" }, { name: "JavaScript" }, { name: "CSS" }],
    },
    latestRelease: {
      name: "Next.js 15",
      tagName: "v15.0.0",
      publishedAt: "2025-10-21T12:00:00Z",
      url: "https://github.com/vercel/next.js/releases/tag/v15.0.0",
      description: "Release notes",
    },
    defaultBranchRef: {
      name: "canary",
      target: {
        history: {
          totalCount: 21_000,
          edges: [{ node: { committedDate: "2026-01-01T00:00:00Z" } }],
        },
      },
    },
    ...overrides,
  }
}

describe("buildBatchRepoInfoQuery", () => {
  it("emits one alias and one variable pair per repository", () => {
    const query = buildBatchRepoInfoQuery(3)

    expect(query).toContain("$owner0: String!, $name0: String!")
    expect(query).toContain("$owner2: String!, $name2: String!")
    expect(query).toContain("r0: repository(owner: $owner0, name: $name0)")
    expect(query).toContain("r2: repository(owner: $owner2, name: $name2)")
    // A third repository must not emit a fourth alias.
    expect(query).not.toContain("r3:")
  })

  it("keeps the alias set balanced, which is what makes one request valid", () => {
    const query = buildBatchRepoInfoQuery(50)
    const aliases = query.match(/r\d+: repository\(/g) ?? []
    const declarations = query.match(/\$owner\d+: String!/g) ?? []

    expect(aliases).toHaveLength(50)
    expect(declarations).toHaveLength(50)
  })

  it("rejects an empty or oversized batch", () => {
    expect(() => buildBatchRepoInfoQuery(0)).toThrow()
    expect(() => buildBatchRepoInfoQuery(-1)).toThrow()
    expect(() => buildBatchRepoInfoQuery(MAX_BATCH_SIZE + 1)).toThrow()
  })
})

describe("chunk", () => {
  it("splits into batches no larger than the requested size", () => {
    const input = Array.from({ length: 250 }, (_, i) => i)
    const batches = chunk(input, MAX_BATCH_SIZE)

    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(100)
    expect(batches[1]).toHaveLength(100)
    expect(batches[2]).toHaveLength(50)
    expect(batches.flat()).toEqual(input)
  })

  it("returns no batches for an empty input", () => {
    expect(chunk([], 10)).toEqual([])
  })
})

describe("extractRepoInfo", () => {
  it("flattens a full repository node", () => {
    const info = extractRepoInfo({ repository: repositoryNode() })

    expect(info.fullName).toBe("vercel/next.js")
    expect(info.owner).toBe("vercel")
    expect(info.name).toBe("next.js")
    expect(info.stars).toBe(130_000)
    expect(info.forks).toBe(27_000)
    expect(info.archived).toBe(false)
    expect(info.defaultBranch).toBe("canary")
    expect(info.licenseSpdxId).toBe("MIT")
    expect(info.commitCount).toBe(21_000)
    expect(info.topics).toEqual(["react", "nextjs"])
    expect(info.languages).toEqual(["TypeScript", "JavaScript", "CSS"])
    expect(info.latestReleaseTagName).toBe("v15.0.0")
    expect(info.usesCustomOpenGraphImage).toBe(true)
  })

  it("derives the owner id from the avatar url", () => {
    const info = extractRepoInfo({ repository: repositoryNode() })
    expect(info.ownerId).toBe(14_985_020)
  })

  it("reads commit and release timestamps as dates", () => {
    const info = extractRepoInfo({ repository: repositoryNode() })
    expect(info.lastCommit).toBeInstanceOf(Date)
    expect(info.lastCommit.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(info.latestReleasePublishedAt?.toISOString()).toBe(
      "2025-10-21T12:00:00.000Z"
    )
  })

  it("strips emoji and :shortcode: markers from the description", () => {
    const info = extractRepoInfo({
      repository: repositoryNode({ description: "Fast :rocket: framework 🚀" }),
    })
    expect(info.description).toBe("Fast framework")
  })

  it("falls back to main when the default branch is absent", () => {
    const info = extractRepoInfo({
      repository: repositoryNode({ defaultBranchRef: null }),
    })
    expect(info.defaultBranch).toBe("main")
    expect(info.commitCount).toBe(0)
  })

  it("tolerates a node from the reduced query, leaving counts at zero", () => {
    // The client's third fallback drops the expensive counted fields; the
    // REST backfill fills them in afterwards.
    const info = extractRepoInfo({
      repository: {
        name: "hono",
        owner: { login: "honojs", avatarUrl: "" },
        defaultBranchRef: { name: "main" },
      },
    })

    expect(info.fullName).toBe("honojs/hono")
    expect(info.stars).toBe(0)
    expect(info.forks).toBe(0)
    expect(info.languages).toEqual([])
    expect(info.latestReleasePublishedAt).toBeUndefined()
    expect(info.licenseSpdxId).toBe("")
  })

  it("throws when the repository node is missing entirely", () => {
    expect(() => extractRepoInfo({})).toThrow()
    expect(() => extractRepoInfo({ repository: null })).toThrow()
  })
})
