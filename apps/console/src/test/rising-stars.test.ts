/**
 * Unit tests for the Rising Stars selection rules.
 *
 * The category filtering is the part that fails quietly: a project silently
 * dropped from the "all" bucket because of an excluded tag looks exactly like
 * a project that simply did not grow. These tests pin the rules without a
 * database.
 */
import { describe, expect, it } from "vitest"
import {
  defaultRisingStarCategories,
  selectByCategory,
  type RisingStarProject,
} from "@/lib/github/service/rising-stars"

function project(
  fullName: string,
  delta: number,
  tags: string[],
  slug?: string
): RisingStarProject {
  return {
    name: fullName.split("/")[1]!,
    slug: slug ?? fullName.split("/")[1]!,
    full_name: fullName,
    description: "desc",
    stars: 1000 + delta,
    delta,
    monthly: [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    tags,
    owner_id: 1,
    created_at: "2024-01-01T00:00:00Z",
  }
}

describe("defaultRisingStarCategories", () => {
  it("carries an 'all' bucket, which selection requires", () => {
    expect(
      defaultRisingStarCategories.find((c) => c.key === "all")
    ).toBeDefined()
  })
})

describe("selectByCategory", () => {
  it("selects the top of the 'all' bucket in star-delta order", () => {
    const input = [
      project("org/a", 10, []),
      project("org/b", 50, []),
      project("org/c", 30, []),
    ]
    const categories = [{ key: "all", count: 2 }]

    const { projects } = selectByCategory(input, categories, new Set())

    expect(projects.map((p) => p.full_name)).toEqual(["org/b", "org/c"])
    expect(projects[0]?.delta).toBe(50)
  })

  it("excludes an excluded-tag project from the overall bucket", () => {
    const input = [
      project("org/kept", 40, ["cli"]),
      project("org/drop", 100, ["meta"]),
    ]
    const categories = [{ key: "all", count: 2 }]

    const { projects } = selectByCategory(input, categories, new Set(["meta"]))

    expect(projects.map((p) => p.full_name)).toEqual(["org/kept"])
  })

  it("adds a project a sub-category picks that the overall bucket skipped", () => {
    // "drop" carries the excluded tag so the overall bucket refuses it, but a
    // sub-category that explicitly wants that tag still gets it. The report
    // keeps the year's delta order, so "drop" still leads despite the tag.
    const input = [
      project("org/kept", 40, ["cli"]),
      project("org/drop", 100, ["meta"]),
    ]
    const categories = [
      { key: "all", count: 2 },
      { key: "meta", count: 1, tags: ["meta"] },
    ]

    const { projects, categoryByFullName } = selectByCategory(
      input,
      categories,
      new Set(["meta"])
    )

    expect(projects.map((p) => p.full_name)).toEqual(["org/drop", "org/kept"])
    expect(categoryByFullName.get("org/kept")).toBe("all")
    expect(categoryByFullName.get("org/drop")).toBe("meta")
  })

  it("does not duplicate a project selected by two categories", () => {
    const input = [project("org/a", 10, ["cli", "css"])]
    const categories = [
      { key: "all", count: 1 },
      { key: "cli", count: 1, tags: ["cli"] },
      { key: "css", count: 1, tags: ["css"] },
    ]

    const { projects } = selectByCategory(input, categories, new Set())

    expect(projects).toHaveLength(1)
  })

  it("respects a sub-category's excluded tags and excluded slugs", () => {
    const input = [
      project("org/keep", 50, ["cli"], "keep"),
      project("org/slug-out", 100, ["cli"], "slug-out"),
      project("org/tag-out", 80, ["cli", "legacy"], "tag-out"),
    ]
    const categories = [
      { key: "all", count: 1 },
      {
        key: "cli",
        count: 5,
        tags: ["cli"],
        excluded: ["slug-out"],
        excludedTags: ["legacy"],
      },
    ]

    const { projects } = selectByCategory(input, categories, new Set())

    expect(projects.map((p) => p.full_name)).toEqual([
      "org/slug-out",
      "org/keep",
    ])
  })

  it("ignores a disabled sub-category", () => {
    const input = [project("org/a", 10, ["cli"])]
    const categories = [
      { key: "all", count: 0 },
      { key: "cli", count: 1, tags: ["cli"], disabled: true },
    ]

    const { projects } = selectByCategory(input, categories, new Set())

    expect(projects).toHaveLength(0)
  })

  it("falls back to its own key when a sub-category has no tags", () => {
    const input = [project("org/a", 10, ["css"])]
    const categories = [
      { key: "all", count: 0 },
      // No `tags`, so the selection looks for the key itself.
      { key: "css", count: 1 },
    ]

    const { projects } = selectByCategory(input, categories, new Set())

    expect(projects.map((p) => p.full_name)).toEqual(["org/a"])
  })

  it("throws when the 'all' category is missing", () => {
    const input = [project("org/a", 10, [])]

    expect(() => selectByCategory(input, [], new Set())).toThrow(/all/)
  })
})
