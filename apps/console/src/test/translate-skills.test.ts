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

  it("keeps results aligned with their skills when a later one finishes first", async () => {
    // The first skill is the slowest, so a fan-out that returned results as they
    // landed would put "a" where "b" belongs and every caller would store the
    // wrong translation against the wrong document.
    const translate = vi.fn(async (description: string) => {
      const delay = description === "one" ? 20 : 1
      await new Promise((r) => setTimeout(r, delay))
      return { descriptionZh: `译:${description}`, readmeZh: "" }
    })

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
  })

  it("does not translate a whole repository one skill at a time", async () => {
    // This is the whole reason for the fan-out: a repository with a dozen skills
    // was spending minutes in here, which is longer than an ingest caller waits.
    let inFlight = 0
    let peak = 0
    const translate = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight -= 1
      return { descriptionZh: "译", readmeZh: "" }
    })

    const skills = Array.from({ length: 12 }, (_, i) => ({
      skillDir: `s${i}`,
      description: `d${i}`,
      readme: `r${i}`,
    }))
    const result = await translateSkills(skills, new Map(), translate)

    expect(result).toHaveLength(12)
    expect(peak).toBeGreaterThan(1)
    // And bounded, so a large repository cannot spend a provider's whole budget
    // on one sync.
    expect(peak).toBeLessThanOrEqual(4)
  })

  it("rejects when one translation rejects, as the sequential loop did", async () => {
    const translate = vi.fn(async (description: string) => {
      if (description === "bad") throw new Error("model unavailable")
      return { descriptionZh: "译", readmeZh: "" }
    })

    await expect(
      translateSkills(
        [
          { skillDir: "a", description: "good", readme: "r1" },
          { skillDir: "b", description: "bad", readme: "r2" },
        ],
        new Map(),
        translate
      )
    ).rejects.toThrow("model unavailable")
  })
})
