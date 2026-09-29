/**
 * The skills webhook payload contract.
 *
 * Pure shape tests, so they run without a database. The consumer stores these
 * fields under its own names, which is why every key the source sent is still
 * sent, snake_case included, even when its value is null.
 */
import { describe, expect, it } from "vitest"
import { buildSkillWebhookPayload } from "@/lib/webhook/skill-webhook"

describe("buildSkillWebhookPayload", () => {
  it("carries the skill under the repository that owns it", () => {
    const payload = buildSkillWebhookPayload({
      repoOwner: "acme",
      repoName: "skills",
      skillDir: "pdf",
      name: "pdf",
      description: "Work with PDFs",
      descriptionZh: "处理 PDF",
      readme: "Body",
      readmeZh: "正文",
      version: "1.0.0",
    })

    expect(payload.event_type).toBe("skill_updated")
    expect(payload.data.repo_full_name).toBe("acme/skills")
    expect(payload.data.repo_name).toBe("skills")
    expect(payload.data.repo_owner).toBe("acme")
    expect(payload.data.skill_dir).toBe("pdf")
    expect(payload.data.name).toBe("pdf")
    expect(payload.data.description).toBe("Work with PDFs")
    expect(payload.data.description_zh).toBe("处理 PDF")
    expect(payload.data.readme).toBe("Body")
    expect(payload.data.readme_zh).toBe("正文")
    expect(payload.data.version).toBe("1.0.0")
  })

  it("defaults untracked fields to null rather than omitting them", () => {
    const payload = buildSkillWebhookPayload({
      repoOwner: "acme",
      repoName: "skills",
      skillDir: "pdf",
      name: "pdf",
      description: "d",
      descriptionZh: "",
      readme: "r",
      readmeZh: "",
    })

    expect(payload.data.name_zh).toBeNull()
    expect(payload.data.version).toBeNull()
    expect(payload.data.category_id).toBeNull()
    expect(payload.data.features).toBeNull()
    expect(payload.data.scenario).toBeNull()
    expect(payload.data.license).toBeNull()
    expect(payload.data.tools).toBeNull()
  })
})
