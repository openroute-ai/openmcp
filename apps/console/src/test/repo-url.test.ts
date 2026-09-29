import { describe, expect, it } from "vitest"
import {
  normalizeGithubRepoInput,
  parseGithubRepoUrl,
} from "@/lib/github/repo-url"

describe("parseGithubRepoUrl", () => {
  it("parses the canonical https form", () => {
    expect(
      parseGithubRepoUrl(
        "https://github.com/anthropics/anthropic-sdk-typescript"
      )?.fullName
    ).toBe("anthropics/anthropic-sdk-typescript")
  })

  it("parses git@ SSH remotes and drops the .git suffix", () => {
    expect(
      parseGithubRepoUrl("git@github.com:vercel/next.js.git")?.fullName
    ).toBe("vercel/next.js")
  })

  it("parses the ssh:// protocol", () => {
    expect(
      parseGithubRepoUrl("ssh://git@github.com/pnpm/pnpm.git")?.fullName
    ).toBe("pnpm/pnpm")
  })

  it("strips a trailing slash, query string and hash", () => {
    expect(
      parseGithubRepoUrl("https://github.com/honojs/hono?tab=readme#top")
        ?.fullName
    ).toBe("honojs/hono")
    expect(
      parseGithubRepoUrl("https://github.com/honojs/hono/")?.fullName
    ).toBe("honojs/hono")
  })

  it("ignores extra path segments after the repository", () => {
    expect(
      parseGithubRepoUrl("https://github.com/facebook/react/tree/main/packages")
        ?.fullName
    ).toBe("facebook/react")
  })

  it("parses a bare owner/repo and a scheme-less host", () => {
    expect(parseGithubRepoUrl("openai/openai-node")?.fullName).toBe(
      "openai/openai-node"
    )
    expect(parseGithubRepoUrl("github.com/honojs/hono")?.fullName).toBe(
      "honojs/hono"
    )
  })

  it("always returns the canonical https url", () => {
    expect(parseGithubRepoUrl("git@github.com:vercel/next.js.git")?.url).toBe(
      "https://github.com/vercel/next.js"
    )
  })

  it("rejects non-GitHub hosts and malformed input", () => {
    expect(parseGithubRepoUrl("https://gitlab.com/foo/bar")).toBeNull()
    expect(parseGithubRepoUrl("https://example.com/foo")).toBeNull()
    expect(parseGithubRepoUrl("not a url")).toBeNull()
    expect(parseGithubRepoUrl("")).toBeNull()
    expect(parseGithubRepoUrl(null)).toBeNull()
    expect(parseGithubRepoUrl(undefined)).toBeNull()
  })

  it("rejects a bare owner with no repository", () => {
    expect(parseGithubRepoUrl("https://github.com/vercel")).toBeNull()
  })

  it("rejects path traversal and other unsafe segments", () => {
    expect(parseGithubRepoUrl("../../etc/passwd")).toBeNull()
    expect(parseGithubRepoUrl("https://github.com/..%2f..%2fetc")).toBeNull()
    expect(parseGithubRepoUrl("owner/repo;rm -rf /")).toBeNull()
  })

  // The create-project dialog runs this same parser as its local gate, so a
  // shape accepted here must not be rejected by the form before submission.
  it("accepts the URL shapes a user actually pastes into the form", () => {
    for (const input of [
      "https://github.com/openroute-ai/openmcp",
      "https://github.com/openroute-ai/openmcp.git",
      "https://github.com/openroute-ai/openmcp/",
      "https://github.com/openroute-ai/openmcp.git/",
      "https://github.com/openroute-ai/openmcp/tree/main",
    ]) {
      expect(parseGithubRepoUrl(input)?.fullName).toBe("openroute-ai/openmcp")
    }
  })
})

describe("normalizeGithubRepoInput", () => {
  it("normalises every accepted shape to owner/repo", () => {
    const expected = "tursodoo/odoo"
    expect(
      normalizeGithubRepoInput("https://github.com/tursodoo/odoo.git")
    ).toBe(expected)
    expect(normalizeGithubRepoInput("tursodoo/odoo")).toBe(expected)
    expect(normalizeGithubRepoInput("git@github.com:tursodoo/odoo.git")).toBe(
      expected
    )
  })

  it("returns null for unusable input", () => {
    expect(normalizeGithubRepoInput("https://gitlab.com/foo/bar")).toBeNull()
  })
})
