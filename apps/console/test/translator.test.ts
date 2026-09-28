/**
 * Unit tests for the GPT translator.
 *
 * The generate function is injected, so these run with no network and no
 * provider credentials. The "no provider configured" path is the default
 * generate raising, which every method must survive by falling back.
 */
import { describe, expect, it, vi } from "vitest"
import { isChinese, Translator } from "@/lib/ai/translator"
import type { Generate } from "@/lib/ai/translator"

function fakeGenerate(handler?: (prompt: string) => string): Generate {
  const generate = vi.fn(async (prompt: string) =>
    handler ? handler(prompt) : `zh(${prompt.slice(0, 12)}…)`
  ) as unknown as Generate
  return generate
}

describe("isChinese", () => {
  it("accepts predominantly Han text", () => {
    expect(isChinese("这是一个中文技能描述")).toBe(true)
  })

  it("rejects predominantly Latin text", () => {
    expect(isChinese("This is an English skill")).toBe(false)
  })

  it("rejects empty and whitespace-only input", () => {
    expect(isChinese("")).toBe(false)
    expect(isChinese("   ")).toBe(false)
  })
})

describe("Translator", () => {
  it("passes a Chinese description through without calling the model", async () => {
    const generate = fakeGenerate()
    const translator = new Translator(generate)

    const result = await translator.translateDescription("这是一个中文技能描述")

    expect(result).toBe("这是一个中文技能描述")
    expect(generate).not.toHaveBeenCalled()
  })

  it("passes a Chinese readme through without calling the model", async () => {
    const generate = fakeGenerate()
    const translator = new Translator(generate)

    const result = await translator.translateReadme("# 中文标题\n正文")

    expect(result).toBe("# 中文标题\n正文")
    expect(generate).not.toHaveBeenCalled()
  })

  it("translates an English description through the model", async () => {
    const prompts: string[] = []
    const translator = new Translator(
      fakeGenerate((prompt) => {
        prompts.push(prompt)
        return "处理 PDF 文件"
      })
    )

    const result = await translator.translateDescription("Work with PDF files")

    expect(result).toBe("处理 PDF 文件")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("翻译成中文")
  })

  it("translates an English readme, keeping markdown instructions in the prompt", async () => {
    const prompts: string[] = []
    const translator = new Translator(
      fakeGenerate((prompt) => {
        prompts.push(prompt)
        return "处理 PDF 文件"
      })
    )

    const result = await translator.translateReadme("# Work with PDFs\nBody")

    expect(result).toBe("处理 PDF 文件")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("保持所有Markdown格式")
  })

  it("returns the empty string for an empty description", async () => {
    const generate = fakeGenerate()
    const translator = new Translator(generate)

    expect(await translator.translateDescription("")).toBe("")
    expect(generate).not.toHaveBeenCalled()
  })

  it("falls back to the source when the model call fails", async () => {
    const generate = vi.fn(async () => {
      throw new Error("provider unreachable")
    }) as unknown as Generate
    const translator = new Translator(generate)

    expect(await translator.translateDescription("Work with PDFs")).toBe(
      "Work with PDFs"
    )
    expect(await translator.translateReadme("# Readme")).toBe("# Readme")
  })

  it("survives having no provider configured", async () => {
    // The default generate raises "No AI provider configured"; both methods
    // must degrade to the source text instead of throwing into the task.
    const translator = new Translator()

    expect(await translator.translateDescription("Work with PDFs")).toBe(
      "Work with PDFs"
    )
    expect(await translator.translateReadme("Body")).toBe("Body")
  })
})
