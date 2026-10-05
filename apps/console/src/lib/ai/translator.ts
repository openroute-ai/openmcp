/**
 * GPT-powered English→Chinese translation for short fields and documents.
 *
 * This is the source app's translator, re-hosted on the console's provider
 * configuration. The prompts are kept exactly as the source used them: their
 * output is the contract for what ends up in `description_zh` and `readme_zh`
 * and then in the skills webhook, and changing the prompt changes downstream
 * text someone else displays.
 *
 * The whole class is safe to call with no provider configured: `generate` is
 * injected, and the default raises when it cannot build a model, which the
 * callers treat as "no translation available" rather than as a hard failure.
 */

import { generateText } from "ai"
import { createChatModel } from "@/lib/ai/provider"

export interface GenerateOptions {
  temperature?: number
  maxOutputTokens?: number
}

export type Generate = (
  prompt: string,
  options?: GenerateOptions
) => Promise<string>

/**
 * How long one model call may take before it is abandoned.
 *
 * A README translation is one call with a 8000-token ceiling, so a slow provider
 * can legitimately need a while — but not indefinitely. Without a bound a single
 * stalled call holds the skill sync open: the ingest route is still waiting on it
 * when its caller gives up, and the sync job it started stays `running` with
 * nothing stored, which is a state neither an operator nor the retry queue can
 * read. Every caller here already treats a failed translation as "keep the
 * original text", so timing out costs a translation and nothing else.
 */
const GENERATE_TIMEOUT_MS = 45_000

const defaultGenerate: Generate = async (prompt, options) => {
  const model = createChatModel()
  if (!model) throw new Error("No AI provider configured")
  const { text } = await generateText({
    model,
    prompt,
    temperature: options?.temperature,
    maxOutputTokens: options?.maxOutputTokens,
    abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  })
  return text
}

/** True when more than half of the non-space characters are Han. */
export function isChinese(text: string): boolean {
  if (!text) return false

  const significant = text.replace(/[\s\p{P}]/gu, "")
  if (significant.length === 0) return false

  const chinese = significant.match(/[\u4e00-\u9fff]/g)
  return (chinese?.length ?? 0) / significant.length > 0.6
}

export class Translator {
  constructor(private readonly generate: Generate = defaultGenerate) {}

  /** Translates a description, keeping it as-is when it is already Chinese. */
  async translateDescription(description: string): Promise<string> {
    if (!description) return ""
    if (isChinese(description)) return description

    try {
      return await this.translateToChinese(description)
    } catch {
      return description
    }
  }

  /** Translates a README, keeping it as-is on failure or already-Chinese. */
  async translateReadme(readme: string): Promise<string> {
    if (!readme) return ""
    if (isChinese(readme)) return readme

    try {
      const translated = await this.generate(
        `请将以下README文档翻译成中文，严格保持原有的文档结构和格式：

${readme}

翻译要求：
1. 保持所有Markdown格式（标题层级、列表、代码块、链接等）
2. 不要翻译代码块中的内容、URL、文件名、变量名等技术术语
3. 保持原有的换行、缩进、空行等格式
4. 只翻译自然语言文本内容
5. 保持表格结构，只翻译表头和内容文本
6. 保持图片链接和alt文本格式
7. 保持徽章（badge）的格式不变

翻译结果：`,
        { temperature: 0.2, maxOutputTokens: 8000 }
      )
      return translated || readme
    } catch {
      return readme
    }
  }

  /** Translates a release note, keeping it as-is on failure or already-Chinese. */
  async translateReleaseNote(releaseDescription: string): Promise<string> {
    if (!releaseDescription) return ""
    if (isChinese(releaseDescription)) return releaseDescription

    try {
      const translated = await this.generate(
        `请将以下Release Note翻译成中文，保持原有的格式和结构：

${releaseDescription}

翻译要求：
1. 保持版本号、日期等格式不变
2. 保持列表格式和缩进
3. 不要翻译技术术语、函数名、变量名等
4. 只翻译功能描述、修复说明等自然语言内容
5. 保持链接格式不变
6. 保持代码示例格式不变

翻译结果：`,
        { temperature: 0.3, maxOutputTokens: 4000 }
      )
      return translated || releaseDescription
    } catch {
      return releaseDescription
    }
  }

  private async translateToChinese(text: string): Promise<string> {
    const translated = await this.generate(
      `请将以下文本翻译成中文，保持原有的格式和结构，只翻译文本内容，不要翻译代码、URL、文件名、变量名等技术术语：

${text}

翻译要求：
1. 保持原有的换行、缩进、标点符号等格式
2. 不要翻译代码块、URL、文件名、变量名、函数名等技术术语
3. 只翻译自然语言文本内容
4. 保持Markdown格式（如#标题、**粗体**、*斜体*等）
5. 如果原文已经是中文，直接返回原文

翻译结果：`,
      { temperature: 0.3 }
    )
    return translated || text
  }
}

export const translator = new Translator()
