/**
 * Unit tests for the per-skill translation reuse.
 *
 * The policy is token economics: an unchanged document that already has a
 * translation is never sent to the model again. These tests pin which inputs
 * go to the model and which are reused, without any provider involved.
 */
import { describe, expect, it, vi } from "vitest"
import { translateSkills } from "@/lib/ai/translate-skills"
import { contentHash } from "@/lib/github/skill"
import type { SkillRow } from "@/lib/github/service/skill"

function asRow(
  skillDir: string,
  contentHashValue: string,
  descriptionZh = "旧的描述",
  readmeZh = "旧的正文"
): SkillRow {
  return {
    id: `${skillDir}-id`,
    skillDir,
    name: skillDir,
    description: "en",
    descriptionZh,
    readme: "en",
    readmeZh,
    version: null,
    contentHash: contentHashValue,
    syncedToWebAt: null,
    lastSyncError: null,
    lastSyncAttemptAt: null,
    createdAt: new Date(),
    updatedAt: null,
  } as SkillRow
}

describe("translateSkills", () => {
  it("calls the translate fn for a skill that has never been stored", async () => {
    const translate = vi.fn(async () => ({
      descriptionZh: "新描述",
      readmeZh: "新正文",
    }))

    const result = await translateSkills(
      [{ skillDir: "pdf", description: "d", readme: "r" }],
      new Map(),
      translate
    )

    expect(translate).toHaveBeenCalledTimes(1)
    expect(result[0]).toEqual({ descriptionZh: "新描述", readmeZh: "新正文" })
  })

  it("reuses the stored translation when the document is unchanged", async () => {
    const raw = "# Readme"
    const translate = vi.fn(async () => ({ descriptionZh: "x", readmeZh: "y" }))
    const stored = new Map([
      ["pdf", asRow("pdf", contentHash(raw), "已翻译描述", "已翻译正文")],
    ])

    const result = await translateSkills(
      [{ skillDir: "pdf", description: "d", readme: raw }],
      stored,
      translate
    )

    expect(result[0]).toEqual({
      descriptionZh: "已翻译描述",
      readmeZh: "已翻译正文",
    })
    expect(translate).not.toHaveBeenCalled()
  })

  it("translates an unchanged document whose zh fields are still empty", async () => {
    const raw = "# Readme"
    const translate = vi.fn(async () => ({ descriptionZh: "新", readmeZh: "" }))
    const stored = new Map([["pdf", asRow("pdf", contentHash(raw), "", "")]])

    const result = await translateSkills(
      [{ skillDir: "pdf", description: "d", readme: raw }],
      stored,
      translate
    )

    expect(result[0]).toEqual({ descriptionZh: "新", readmeZh: "" })
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it("retranslates a document that changed upstream", async () => {
    const translate = vi.fn(async () => ({
      descriptionZh: "新",
      readmeZh: "新",
    }))
    const stored = new Map([
      ["pdf", asRow("pdf", contentHash("# old"), "旧", "旧")],
    ])

    const result = await translateSkills(
      [{ skillDir: "pdf", description: "d", readme: "# new" }],
      stored,
      translate
    )

    expect(result[0]).toEqual({ descriptionZh: "新", readmeZh: "新" })
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it("returns one translation per input, in input order", async () => {
    const translate = vi.fn(async (description: string) => ({
      descriptionZh: `译:${description}`,
      readmeZh: "",
    }))

    const result = await translateSkills(
      [
        { skillDir: "a", description: "one", readme: "r1" },
        { skillDir: "b", description: "two", readme: "r2" },
      ],
      new Map(),
      translate
    )

    expect(result).toEqual([
      { descriptionZh: "译:one", readmeZh: "" },
      { descriptionZh: "译:two", readmeZh: "" },
    ])
    expect(translate).toHaveBeenCalledTimes(2)
  })
})
