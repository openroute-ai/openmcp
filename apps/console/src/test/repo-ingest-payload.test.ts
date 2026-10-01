import { describe, expect, it } from "vitest"
import { parseRepoIngest } from "@/lib/github/repo-info-payload"

const NOW = "2024-01-01T00:00:00.000Z"

function repoInfoPayload() {
  return {
    name: "react",
    fullName: "facebook/react",
    owner: "facebook",
    ownerId: 1,
    createdAt: NOW,
    pushedAt: NOW,
    lastCommit: NOW,
  }
}

describe("parseRepoIngest", () => {
  it("parses a full RepoInfo as the info form", () => {
    const result = parseRepoIngest(repoInfoPayload())
    expect(result.ok).toBe(true)
    if (result.ok && result.ingest.kind === "info") {
      expect(result.ingest.info.fullName).toBe("facebook/react")
    } else {
      throw new Error("expected the info form")
    }
  })

  it("parses a bare URL as the url form, defaulting to a skill project", () => {
    const result = parseRepoIngest({ url: "https://github.com/o/r.git" })
    expect(result).toEqual({
      ok: true,
      ingest: { kind: "url", url: "https://github.com/o/r.git", type: "skill" },
    })
  })

  it("accepts a URL with an explicit type", () => {
    const result = parseRepoIngest({
      url: "https://github.com/o/r",
      type: "application",
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.ingest.kind === "url") {
      expect(result.ingest.type).toBe("application")
    } else {
      throw new Error("expected the url form")
    }
  })

  it("tolerates redundant owner/name alongside a URL", () => {
    // The shape this app used to send must not become a 400.
    const result = parseRepoIngest({
      url: "https://github.com/facebook/react",
      owner: "facebook",
      name: "react",
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ingest.kind).toBe("url")
  })

  it("rejects a body that is neither form, reporting the RepoInfo issue", () => {
    const result = parseRepoIngest({ name: "react" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("fullName")
  })

  it("rejects an unknown project type", () => {
    const result = parseRepoIngest({ url: "https://github.com/o/r", type: "nope" })
    expect(result.ok).toBe(false)
  })
})
