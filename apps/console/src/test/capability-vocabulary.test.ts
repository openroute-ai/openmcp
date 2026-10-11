import { describe, expect, it } from "vitest"
import {
  deriveCapabilityVocabulary,
  deriveRepoCapabilitySeeds,
  repoTagsFromTopics,
  slugifyLanguage,
  slugifyTopic,
} from "@/lib/github/capability-vocabulary"

describe("slugifyLanguage", () => {
  it("lowercases ordinary names", () => {
    expect(slugifyLanguage("TypeScript")).toBe("typescript")
    expect(slugifyLanguage("Python")).toBe("python")
  })

  it("spells out symbols that a slug would mangle", () => {
    expect(slugifyLanguage("C++")).toBe("cpp")
    expect(slugifyLanguage("C#")).toBe("csharp")
    expect(slugifyLanguage("F#")).toBe("fsharp")
    expect(slugifyLanguage(".NET")).toBe("dotnet")
  })
})

describe("slugifyTopic", () => {
  it("produces a stable lowercase code", () => {
    expect(slugifyTopic("Open Source")).toBe("open-source")
    expect(slugifyTopic("MCP Server")).toBe("mcp-server")
    expect(slugifyTopic(" claude! ")).toBe("claude")
  })
})

describe("repoTagsFromTopics", () => {
  it("slugs, dedupes and stops at the limit", () => {
    const tags = repoTagsFromTopics(
      ["MCP", "mcp", "AI Agents", "Python"],
      3
    )
    expect(tags).toHaveLength(3)
    expect(tags[0]).toEqual({ code: "mcp", name: "MCP" })
    expect(tags.map((t) => t.code)).toEqual(["mcp", "ai-agents", "python"])
  })

  it("drops the meta topics that say nothing about a project", () => {
    const tags = repoTagsFromTopics(
      ["awesome-list", "hacktoberfest", "good-first-issue", "mcp", "python"],
      5
    )
    expect(tags.map((t) => t.code)).toEqual(["mcp", "python"])
  })

  it("returns nothing for empty or non-array input", () => {
    expect(repoTagsFromTopics(null, 5)).toEqual([])
    expect(repoTagsFromTopics([], 5)).toEqual([])
  })
})

describe("deriveCapabilityVocabulary", () => {
  it("reads every language the corpus speaks", () => {
    const seeds = deriveCapabilityVocabulary({
      topics: [],
      languages: ["TypeScript", "C++"],
    })
    expect(seeds).toContainEqual({
      axis: "language",
      code: "typescript",
      label: "TypeScript",
    })
    expect(seeds).toContainEqual({ axis: "language", code: "cpp", label: "C++" })
  })

  it("includes a keyword capability only when a repository carries the topic", () => {
    const withKafka = deriveCapabilityVocabulary({
      topics: ["kafka", "docker"],
      languages: [],
    })
    expect(withKafka).toContainEqual({
      axis: "dataSource",
      code: "kafka",
      label: "Kafka",
    })
    expect(withKafka).toContainEqual({
      axis: "runtime",
      code: "docker",
      label: "Docker",
    })

    const without = deriveCapabilityVocabulary({
      topics: ["mcp"],
      languages: [],
    })
    expect(without).not.toContainEqual({
      axis: "dataSource",
      code: "kafka",
      label: "Kafka",
    })
  })

  it("groups by axis and sorts stably", () => {
    const seeds = deriveCapabilityVocabulary({
      topics: ["kafka", "mcp", "oauth"],
      languages: ["Python"],
    })
    const keys = seeds.map((s) => `${s.axis}:${s.code}`)
    expect(keys).toEqual(sorted(keys))
    expect(seeds).toContainEqual({ axis: "auth", code: "oauth", label: "OAuth" })
  })
})

describe("deriveRepoCapabilitySeeds", () => {
  it("puts languages first, then topic-derived capabilities", () => {
    const seeds = deriveRepoCapabilitySeeds(
      ["kafka", "mcp-server"],
      ["Python", "TypeScript"],
      4
    )
    expect(seeds.slice(0, 2).map((s) => s.axis)).toEqual([
      "language",
      "language",
    ])
    expect(seeds[seeds.length - 1]).toEqual({
      axis: "category",
      code: "mcp-server",
      label: "MCP server",
    })
  })

  it("accepts the legacy object shape of repos.languages", () => {
    const seeds = deriveRepoCapabilitySeeds([], [{ name: "TypeScript" }], 2)
    expect(seeds[0]).toEqual({
      axis: "language",
      code: "typescript",
      label: "TypeScript",
    })
  })

  it("dedupes and respects the limit", () => {
    const seeds = deriveRepoCapabilitySeeds(
      ["kafka", "mcp-server", "postgres"],
      ["TypeScript", "TypeScript"],
      3
    )
    expect(seeds).toHaveLength(3)
    expect(new Set(seeds.map((s) => `${s.axis}:${s.code}`)).size).toBe(3)
  })
})

function sorted(list: string[]): string[] {
  return [...list].sort(
    (a, b) =>
      ["category", "language", "deployment", "auth", "dataSource", "runtime"]
        .indexOf(a.split(":")[0]!) -
        ["category", "language", "deployment", "auth", "dataSource", "runtime"]
          .indexOf(b.split(":")[0]!) || a.localeCompare(b)
  )
}