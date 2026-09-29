import { describe, expect, it } from "vitest"
import {
  contentHash,
  isSkillDirMode,
  parseSkillMd,
  skillPathInDir,
} from "@/lib/github/skill"

describe("isSkillDirMode", () => {
  it("treats the bare directory name as directory mode", () => {
    expect(isSkillDirMode("skills")).toBe(true)
    expect(isSkillDirMode("skills/")).toBe(true)
    expect(isSkillDirMode("  skills  ")).toBe(true)
  })

  it("treats anything else as a specific file", () => {
    // "skills.md" merely starts with the same characters and is a file, so
    // matching on a prefix would misread it.
    expect(isSkillDirMode("SKILL.md")).toBe(false)
    expect(isSkillDirMode("skills.md")).toBe(false)
    expect(isSkillDirMode("docs/skills/SKILL.md")).toBe(false)
  })
})

describe("skillPathInDir", () => {
  it("places SKILL.md inside the directory", () => {
    expect(skillPathInDir("skills", "pdf")).toBe("skills/pdf/SKILL.md")
  })

  it("normalises a trailing slash on the skills root", () => {
    expect(skillPathInDir("skills/", "pdf")).toBe("skills/pdf/SKILL.md")
  })
})

describe("parseSkillMd", () => {
  it("reads name, description and version from frontmatter", () => {
    const parsed = parseSkillMd(
      [
        "---",
        "name: pdf-processing",
        "description: Work with PDF files",
        "metadata:",
        "  version: 1.2.3",
        "---",
        "",
        "The body of the document.",
      ].join("\n")
    )

    expect(parsed).toEqual({
      name: "pdf-processing",
      description: "Work with PDF files",
      version: "1.2.3",
      readme: "The body of the document.",
    })
  })

  it("accepts a top-level version as well as a nested one", () => {
    // The skill format has used both placements across revisions, so reading
    // only one would silently report a version as absent.
    const nested = parseSkillMd(
      "---\nname: a\nmetadata:\n  version: 2.0.0\n---\nbody"
    )
    const topLevel = parseSkillMd("---\nname: a\nversion: 2.0.0\n---\nbody")

    expect(nested.version).toBe("2.0.0")
    expect(topLevel.version).toBe("2.0.0")
  })

  it("falls back rather than rejecting a document without frontmatter", () => {
    const parsed = parseSkillMd("Just a body, no frontmatter.")

    expect(parsed.name).toBe("Skill")
    expect(parsed.description).toBe("")
    expect(parsed.version).toBeNull()
    expect(parsed.readme).toBe("Just a body, no frontmatter.")
  })

  it("trims whitespace around the fields", () => {
    const parsed = parseSkillMd(
      "---\nname: '  spaced  '\ndescription: '  text  '\n---\n\n  body  \n"
    )

    expect(parsed.name).toBe("spaced")
    expect(parsed.description).toBe("text")
    expect(parsed.readme).toBe("body")
  })

  it("keeps a multi-line body intact", () => {
    const body = "# Title\n\nParagraph one.\n\nParagraph two."
    expect(parseSkillMd(`---\nname: a\n---\n${body}`).readme).toBe(body)
  })
})

describe("contentHash", () => {
  it("is stable for the same document", () => {
    expect(contentHash("# doc")).toBe(contentHash("# doc"))
  })

  it("changes when the document changes", () => {
    expect(contentHash("# doc")).not.toBe(contentHash("# doc!"))
  })

  it("distinguishes documents that differ only in whitespace", () => {
    // A commit can reformat a skill without changing what it means, and the
    // hash is what decides whether it is re-pushed.
    expect(contentHash("a b")).not.toBe(contentHash("a  b"))
  })

  it("does not collide on two different documents", () => {
    // A 32-bit hash collides often enough on real documents to skip a
    // genuine change, which is why this is SHA-256.
    expect(contentHash("doc one")).not.toBe(contentHash("doc two"))
  })
})
