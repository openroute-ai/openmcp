import { describe, expect, it } from "vitest"
import { languageNames, primaryLanguage } from "@/lib/github/languages"

describe("languageNames", () => {
  it("reads the names out of rows written by an older writer", () => {
    // Every non-empty `repos.languages` row in the database stores objects.
    // Rendering the first entry raw is what took the public project page down.
    expect(languageNames([{ name: "Clojure" }, { name: "Rust" }])).toEqual([
      "Clojure",
      "Rust",
    ])
  })

  it("reads the plain strings the current writer stores", () => {
    expect(languageNames(["TypeScript", "JavaScript"])).toEqual([
      "TypeScript",
      "JavaScript",
    ])
  })

  it("keeps GitHub's order, because index 0 is the dominant language", () => {
    expect(languageNames([{ name: "Python" }, { name: "Shell" }])).toEqual([
      "Python",
      "Shell",
    ])
  })

  it("drops an entry with nothing to render rather than stringifying it", () => {
    expect(languageNames([{ name: "" }, {}, null, 3, "Go"])).toEqual(["Go"])
  })

  it("reads a column that holds nothing as no languages at all", () => {
    expect(languageNames(null)).toEqual([])
    expect(languageNames(undefined)).toEqual([])
    expect(languageNames([])).toEqual([])
    expect(languageNames("Clojure")).toEqual([])
  })
})

describe("primaryLanguage", () => {
  it("is the first name, whichever shape the row was stored in", () => {
    expect(primaryLanguage([{ name: "Clojure" }, { name: "Rust" }])).toBe(
      "Clojure"
    )
    expect(primaryLanguage(["Clojure", "Rust"])).toBe("Clojure")
  })

  it("is null rather than empty when nothing was recorded", () => {
    // The callers render null as "未记录" and an empty string as a blank value,
    // which are different claims.
    expect(primaryLanguage([])).toBeNull()
    expect(primaryLanguage(null)).toBeNull()
    expect(primaryLanguage([{}])).toBeNull()
  })
})
