import { computeAndPersistEvalReport } from "@/lib/skills/eval-report-persist"
/**
 * Skill 分类与安全 Enrichment：同步结束后异步执行。
 * 读取全部分类列表，由 AI 根据 skill 内容判断唯一分类、是否安全、应用场景、特性，并更新 DB。
 */
import { generateText, Output } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { eq } from 'drizzle-orm'
import { z } from "zod"
import { db } from "@/lib/db"
import { categories, skills } from "@workspace/db"

const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
})
const model = process.env.OPENAI_MODEL || 'qwen/qwen3-32b'

const EnrichmentSchema = z.object({
  categorySlug: z
    .string()
    .describe('Exactly one category slug from the provided list that best matches this skill'),
  securityLevel: z
    .enum(['safe', 'unsafe', 'pending'])
    .describe('safe = no security concerns; unsafe = has risks; pending = cannot determine'),
  scenario: z
    .string()
    .describe('Short description of typical use cases / application scenario in one sentence'),
  features: z
    .array(z.string())
    .describe('List of 3-8 short feature keywords or phrases for this skill'),
})

export type EnrichmentResult = z.infer<typeof EnrichmentSchema>

/**
 * 对单个 skill 执行 AI enrichment，更新 categoryId、securityLevel、scenario、features 列（不写 metadata）。
 * 失败时仅打日志，不抛错。
 */
export async function runSkillEnrichment(skillId: string): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[enrich-skill] OPENAI_API_KEY not set, skipping enrichment for', skillId)
    return
  }

  const [skill] = await db
    .select({
      id: skills.id,
      title: skills.title,
      description: skills.description,
      readme: skills.readme,
    })
    .from(skills)
    .where(eq(skills.id, skillId))
    .limit(1)
  if (!skill) {
    console.warn('[enrich-skill] skill not found', skillId)
    return
  }

  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
  if (categoryRows.length === 0) {
    console.warn('[enrich-skill] no active categories, skipping', skillId)
    return
  }

  const categoryList = categoryRows.map((c) => `${c.slug} (${c.name})`).join(', ')
  const content = [
    `Title: ${skill.title}`,
    skill.description ? `Description: ${skill.description.slice(0, 2000)}` : '',
    skill.readme ? `Readme (excerpt): ${skill.readme.slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = `You are classifying an MCP skill (a software capability exposed via API).

Available category slugs (choose exactly ONE that best fits): ${categoryList}

Skill content:
${content}

Respond with:
1. categorySlug: exactly one slug from the list above.
2. securityLevel: "safe" if the skill has no security/privilege concerns, "unsafe" if it could access sensitive data or systems without clear safeguards, "pending" if you cannot determine.
3. scenario: one short sentence describing typical use cases.
4. features: 3-8 short keywords or phrases (in 中文) describing what this skill does.`

  try {
    const res = await generateText({
      model: openai.chat(model),
      output: Output.object({
        schema: EnrichmentSchema,
      }),
      prompt,
    })
    const result = res.output as EnrichmentResult

    const categoryRow = categoryRows.find((c) => c.slug === result.categorySlug)
    const categoryId = categoryRow?.id ?? null

    await db
      .update(skills)
      .set({
        categoryId,
        securityLevel: result.securityLevel,
        scenario: result.scenario,
        features: result.features,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, skillId))

    console.log('[enrich-skill] done', { skillId, categorySlug: result.categorySlug, securityLevel: result.securityLevel })
    await computeAndPersistEvalReport(skillId).catch((err: unknown) => {
      console.error('[enrich-skill] evalReport persist failed', skillId, err)
    })
  } catch (err) {
    console.error('[enrich-skill] failed', skillId, err)
  }
}
