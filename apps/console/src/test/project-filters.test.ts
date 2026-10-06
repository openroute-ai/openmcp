/**
 * Tests for the `/projects` browser's URL state.
 *
 * Like `pagination.test.ts`, these functions are pure — no database, no
 * rendering — because the one thing worth pinning down is input handling: the
 * filter state arrives from a URL, and a URL is written by readers, spread by
 * message boards and mutated by agents, none of which know the schema. Every
 * case below is a URL such a reader can actually produce, and the two that
 * matter most are the ones that must never reach SQL: a type the schema does not
 * know is dropped here rather than turned into a query expression, and the sort
 * falls back to the default instead of ordering on an unknown key.
 */
import { describe, expect, it } from "vitest"
import {
  pageOf,
  parseProjectQuery,
  projectsQueryString,
} from "@/lib/public/project-filters"

describe("parseProjectQuery", () => {
  it("is the default state when the URL carries nothing", () => {
    expect(parseProjectQuery({})).toEqual({ q: "", sort: "newest" })
  })

  it("reads keyword, the three facets and a sort from the URL", () => {
    expect(
      parseProjectQuery({
        q: "  claude  ",
        type: "client",
        category: "mcp-server",
        tag: "ai",
        sort: "stars",
      })
    ).toEqual({
      q: "claude",
      type: "client",
      category: "mcp-server",
      tag: "ai",
      sort: "stars",
    })
  })

  it("drops keys the schema does not know instead of erroring", () => {
    expect(parseProjectQuery({ type: "hack", sort: "ascent" })).toEqual({
      q: "",
      sort: "newest",
    })
  })

  it("trims and caps a keyword past a smoke-test length", () => {
    expect(parseProjectQuery({ q: "x".repeat(300) }).q.length).toBe(200)
  })

  it("takes the first of a repeated kind value", () => {
    expect(parseProjectQuery({ type: ["server", "client"] }).type).toBe(
      "server"
    )
  })

  it("reads the first page parameter and ignores the rest", () => {
    expect(pageOf({ page: ["3", "7"] })).toBe("3")
    expect(pageOf({})).toBeUndefined()
  })
})

describe("projectsQueryString", () => {
  it("serializes the default state as no query at all", () => {
    expect(projectsQueryString({ q: "", sort: "newest" })).toBe("")
  })

  it("only writes parameters that differ from the defaults", () => {
    expect(
      projectsQueryString({ q: "x", type: "client", sort: "growth" })
    ).toBe("q=x&type=client&sort=growth")
  })

  it("encodes values the way a URL must", () => {
    expect(
      projectsQueryString({ q: "mcp server", tag: "a&b", sort: "newest" })
    ).toBe("q=mcp+server&tag=a%26b")
  })
})