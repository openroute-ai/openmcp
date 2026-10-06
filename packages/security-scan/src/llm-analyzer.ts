import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { LlmAnalysis, ScanFileInput, SecurityFlagHit, SecurityGrade } from './types'

const LlmSchema = z.object({
  grade: z.enum(['safe', 'caution', 'unsafe']),
  confidence: z.number().min(0).max(1),
  riskSummary: z.string(),
  findings: z.array(
    z.object({
      severity: z.string(),
      description: z.string(),
      mitigation: z.string(),
    })
  ),
  recommendation: z.string(),
})

function client() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
  const baseURL = process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com'
  if (!apiKey) return null
  return createOpenAI({ apiKey, baseURL })
}

function modelId(): string {
  return process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function analyzeWithLlm(
  files: ScanFileInput[],
  flags: SecurityFlagHit[],
  ruleGrade: SecurityGrade
): Promise<LlmAnalysis | null> {
  const openai = client()
  if (!openai) return null

  const excerpt = files
    .slice(0, 12)
    .map((f) => `### ${f.path}\n${f.content.slice(0, 2500)}`)
    .join('\n\n')
    .slice(0, 14_000)

  const flagText = flags.map((f) => `- ${f.name} (${f.severity}) ${f.file}:${f.line} ${f.snippet}`).join('\n')

  const prompt = `You are a security reviewer for AI agent Skills (SKILL.md / scripts / configs).
Distinguish legitimate installer / API-key setup docs from real threats (exfiltration, backdoors, credential theft).

Rule-scan grade: ${ruleGrade}
Flags:
${flagText || '(none)'}

Skill files:
${excerpt}

Return structured JSON only.`

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt)
    try {
      const res = await generateObject({
        model: openai.chat(modelId()) as any,
        schema: LlmSchema,
        prompt,
        system:
          'You review Skill packages. Prefer safe when the hit is a documented installer or negated example. Prefer unsafe when data is sent out or persistence is installed.',
      })
      return res.object as LlmAnalysis | null
    } catch (error) {
      lastError = error
    }
  }
  console.error('[llm-security] failed after retries', lastError)
  return null
}
