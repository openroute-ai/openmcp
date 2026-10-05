import { describe, expect, it, vi } from "vitest"
import {
  contentHash,
  discoverSkillRoot,
  parseSkillMd,
  readSkillSource,
  skillPathInDir,
  skillRootFromPaths,
} from "@/lib/github/skill"
import { GitHubNotFoundError, GitHubRateLimitError } from "@/lib/github/errors"
import type { GitHubClient, PathContent } from "@/lib/github/client"

/** A client that answers one path, so a test states only the path it cares about. */
function clientAnswering(answer: (path: string) => PathContent) {
  const readPath = vi.fn(async (_fullName: string, path: string) =>
    answer(path)
  )
  return { readPath, client: { readPath } as unknown as GitHubClient }
}

/** A client that reports the paths of a repository's skill documents. */
function clientWithDocuments(paths: string[], truncated = false) {
  const findSkillDocuments = vi.fn(async () => ({ paths, truncated }))
  return {
    findSkillDocuments,
    client: { findSkillDocuments } as unknown as GitHubClient,
  }
}

function notFound(): never {
  throw new GitHubNotFoundError("contents/SKILL.md")
}

describe("readSkillSource", () => {
  it("reports a path that is a document as one skill", async () => {
    const { client } = clientAnswering(() => ({
      kind: "file",
      content: "---\nname: pdf\n---\nbody",
    }))

    expect(await readSkillSource(client, "acme/thing", "SKILL.md")).toEqual({
      mode: "file",
      raw: "---\nname: pdf\n---\nbody",
    })
  })

  it("reports a path that is a directory as a directory of skills", async () => {
    // The layout that cannot be recognised by name: `.agents/skills` is a
    // directory of skills, and only the repository knows that.
    const { client } = clientAnswering(() => ({
      kind: "directory",
      entries: [
        {
          name: "agent-browser",
          path: ".agents/skills/agent-browser",
          type: "dir",
        },
        { name: "README.md", path: ".agents/skills/README.md", type: "file" },
        {
          name: "code-review",
          path: ".agents/skills/code-review",
          type: "dir",
        },
      ],
    }))

    expect(
      await readSkillSource(client, "acme/thing", ".agents/skills")
    ).toEqual({ mode: "directory", dirs: ["agent-browser", "code-review"] })
  })

  it("reads a nested directory the same way as one at the root", async () => {
    const { client } = clientAnswering(() => ({
      kind: "directory",
      entries: [{ name: "pdf", path: "packages/skills/pdf", type: "dir" }],
    }))

    expect(
      await readSkillSource(client, "acme/thing", "packages/skills")
    ).toEqual({ mode: "directory", dirs: ["pdf"] })
  })

  it("treats a path the repository does not have as nothing, not a failure", async () => {
    // A 404 is permanent, so it is reported as an absent path rather than
    // raised: raising it put a state that never resolves in the same column as
    // a rate limit, and the retry queue could not tell them apart.
    const { client } = clientAnswering(notFound)

    expect(await readSkillSource(client, "acme/thing", "SKILL.md")).toBeNull()
  })

  it("still raises a failure that a later run could recover from", async () => {
    const { client } = clientAnswering(() => {
      throw new Error("502 Bad Gateway")
    })

    await expect(
      readSkillSource(client, "acme/thing", "SKILL.md")
    ).rejects.toThrow("502 Bad Gateway")
  })
})

describe("skillRootFromPaths", () => {
  it("finds the directory a repository keeps its skills in", () => {
    // The layout that a fixed list of conventional paths would have to be told
    // about: nothing here is named `skills` at the top level.
    expect(
      skillRootFromPaths([
        ".agents/skills/agent-browser/SKILL.md",
        ".agents/skills/code-review/SKILL.md",
      ])
    ).toEqual({ path: ".agents/skills", mode: "directory", documents: 2 })
  })

  it("prefers a single document at the root over anything deeper", () => {
    expect(
      skillRootFromPaths([
        "SKILL.md",
        "examples/nested/SKILL.md",
        ".agents/skills/agent-browser/SKILL.md",
      ])
    ).toEqual({ path: "SKILL.md", mode: "file", documents: 1 })
  })

  it("takes the collection with the most skills rather than the deepest one", () => {
    // A skill one level further down is a nested layout or a fixture shipped
    // alongside the real ones, and it must not outvote them.
    expect(
      skillRootFromPaths([
        ".agents/skills/pdf/SKILL.md",
        ".agents/skills/docx/SKILL.md",
        ".agents/skills/nested/deep/also/SKILL.md",
      ])
    ).toEqual({ path: ".agents/skills", mode: "directory", documents: 3 })
  })

  it("reads one skill in a directory as that document, not as a collection", () => {
    // `skills` with nothing beneath it is not a directory of skills: naming it
    // would resolve to zero skills and the document would never be read.
    expect(skillRootFromPaths(["skills/SKILL.md"])).toEqual({
      path: "skills/SKILL.md",
      mode: "file",
      documents: 1,
    })
  })

  it("keeps one skill in a nested directory as a collection of its own", () => {
    // Different from the case above: there *is* a directory above it, so a
    // sibling added later is picked up without another correction.
    expect(skillRootFromPaths([".agents/skills/pdf/SKILL.md"])).toEqual({
      path: ".agents/skills",
      mode: "directory",
      documents: 1,
    })
  })

  it("falls back to the shallowest cluster when skills are scattered", () => {
    expect(
      skillRootFromPaths([
        "skills/pdf/SKILL.md",
        "vendor/other/SKILL.md",
        "docs/guide/SKILL.md",
      ])
    ).toEqual({ path: "docs", mode: "directory", documents: 1 })
  })

  it("resolves the same answer for the same paths in any order", () => {
    const paths = [
      "skills/b/SKILL.md",
      "skills/a/SKILL.md",
      "vendor/c/SKILL.md",
    ]
    const forward = skillRootFromPaths(paths)
    const reversed = skillRootFromPaths([...paths].reverse())

    expect(forward).toEqual(reversed)
  })

  it("reports nothing for a repository with no skills at all", () => {
    expect(skillRootFromPaths([])).toBeNull()
  })
})

describe("discoverSkillRoot", () => {
  it("asks the repository and returns the directory it reports", async () => {
    const { client } = clientWithDocuments([
      ".agents/skills/ai-sdk/SKILL.md",
      ".agents/skills/chat-sdk/SKILL.md",
    ])

    expect(await discoverSkillRoot(client, "acme/thing", "main")).toEqual({
      path: ".agents/skills",
      mode: "directory",
      documents: 2,
    })
  })

  it("asks for the branch the repository row names", async () => {
    // The default branch, not the default ref: a repository whose skills moved
    // between `main` and `master` has to be read where its code is.
    const { client, findSkillDocuments } = clientWithDocuments([
      "skills/a/SKILL.md",
    ])

    await discoverSkillRoot(client, "acme/thing", "develop")

    expect(findSkillDocuments).toHaveBeenCalledWith("acme/thing", "develop")
  })

  it("treats a repository that is gone as nothing to find", async () => {
    const missing = {
      findSkillDocuments: vi.fn(async () => {
        throw new GitHubNotFoundError("acme/thing")
      }),
    }

    expect(
      await discoverSkillRoot(
        {
          findSkillDocuments: missing.findSkillDocuments,
        } as unknown as GitHubClient,
        "acme/thing"
      )
    ).toBeNull()
  })

  it("still raises a rate limit rather than reporting no skills", async () => {
    // Otherwise a throttled sweep would be recorded as a repository that has no
    // skills, and the stored ones would be kept for the same wrong reason.
    const throttled = {
      findSkillDocuments: vi.fn(async () => {
        throw new GitHubRateLimitError("primary limit", undefined)
      }),
    }

    await expect(
      discoverSkillRoot(
        {
          findSkillDocuments: throttled.findSkillDocuments,
        } as unknown as GitHubClient,
        "acme/thing"
      )
    ).rejects.toBeInstanceOf(GitHubRateLimitError)
  })
})

describe("skillPathInDir", () => {
  it("places SKILL.md inside the directory", () => {
    expect(skillPathInDir("skills", "pdf")).toBe("skills/pdf/SKILL.md")
  })

  it("normalises a trailing slash on the skills root", () => {
    expect(skillPathInDir("skills/", "pdf")).toBe("skills/pdf/SKILL.md")
  })

  it("keeps a nested skills root intact", () => {
    expect(skillPathInDir(".agents/skills", "pdf")).toBe(
      ".agents/skills/pdf/SKILL.md"
    )
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
