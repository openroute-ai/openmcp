import { describe, expect, it } from "vitest"
import { githubAvatarUrl } from "@/lib/github/avatar-url"

describe("githubAvatarUrl", () => {
  it("prefers the id, which is the form that serves a size", () => {
    expect(
      githubAvatarUrl("getpaseo", { ownerId: 259503569, size: 112 })
    ).toBe("https://avatars.githubusercontent.com/u/259503569?v=3&s=112")
  })

  it("falls back to the login when the id is unknown", () => {
    expect(githubAvatarUrl("getpaseo", { size: 112 })).toBe(
      "https://github.com/getpaseo.png"
    )
  })

  it("omits the size rather than asking for one the redirect drops", () => {
    // `github.com/o.png?s=56` lands on the CDN without it and serves 460px,
    // so a size here would claim a saving that never happens.
    expect(githubAvatarUrl("getpaseo")).toBe(
      "https://github.com/getpaseo.png"
    )
  })

  it("appends a size to the id form, rounded", () => {
    expect(githubAvatarUrl("v", { ownerId: 1, size: 112.4 })).toBe(
      "https://avatars.githubusercontent.com/u/1?v=3&s=112"
    )
    expect(githubAvatarUrl("v", { ownerId: 1 })).toBe(
      "https://avatars.githubusercontent.com/u/1"
    )
  })

  it("has no size parameter for a size that cannot be honoured", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(githubAvatarUrl("vercel", { ownerId: 1, size })).toBe(
        "https://avatars.githubusercontent.com/u/1"
      )
    }
  })

  it("ignores an id that could not have been issued by GitHub", () => {
    for (const ownerId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(githubAvatarUrl("vercel", { ownerId })).toBe(
        "https://github.com/vercel.png"
      )
    }
  })

  it("returns null when there is nothing usable, so the caller can fall back", () => {
    expect(githubAvatarUrl(null)).toBeNull()
    expect(githubAvatarUrl(undefined)).toBeNull()
    expect(githubAvatarUrl("")).toBeNull()
    expect(githubAvatarUrl("   ")).toBeNull()
    expect(githubAvatarUrl("  -bad  ", { ownerId: null })).toBeNull()
  })

  it("refuses a login that is not one GitHub could have issued", () => {
    // These would otherwise steer the avatar at another host or another path.
    for (const owner of [
      "vercel/next.js",
      "vercel?x=1",
      "vercel#fragment",
      "../../etc",
      "-leading",
      "trailing-",
      "double--hyphen",
      "has space",
      "https://evil.example",
      "a".repeat(40),
    ]) {
      expect(githubAvatarUrl(owner)).toBeNull()
    }
  })

  it("accepts the logins GitHub actually issues", () => {
    for (const owner of ["a", "dependabot", "openai", "A1", "a-b-c", "0"]) {
      expect(githubAvatarUrl(owner)).toBe(`https://github.com/${owner}.png`)
    }
  })
})
