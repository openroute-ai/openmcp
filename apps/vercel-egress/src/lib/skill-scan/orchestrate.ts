/**
 * Route B 编排：同一套 `scanRepository` + 阶段 2 复核，落成一个
 * `SkillScanReport`。移植自 `apps/console/src/lib/skill-scan/index.ts` 的
 * `runOnVercel` 分支——规则在沙箱内跑，复核在这台函数上跑。
 */
import {
  analyzeWithLlm,
  LLM_UNAVAILABLE,
  mergeGrades,
  runSkillScan,
  SCAN_RULES_VERSION,
  type LlmAnalysis,
  type ScanContext,
  type SecurityFlagHit,
  type SecurityGrade,
  type SkillScanReport,
  type SkillSourceFile,
} from "@workspace/security-scan"
import {
  InSandboxScriptError,
  scanRepository,
  type SandboxScanResult,
} from "./sandbox"

export { InvalidSkillDirError, SkillSourceUnavailableError } from "./errors"
export { InSandboxScriptError } from "./sandbox"

export interface SkillScanInput {
  repoFullName: string
  ref?: string
  skillDir?: string
  includeLlm?: boolean
  signal?: AbortSignal
}

export async function scanRepositoryWithReview(
  input: SkillScanInput
): Promise<SkillScanReport & { context: ScanContext }> {
  const includeLlm = input.includeLlm !== false
  const context = withOwner(undefined, input)
  const preferInSandbox = true

  try {
    const result = await scanRepository({
      repoFullName: input.repoFullName,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(input.skillDir ? { skillDir: input.skillDir } : {}),
      includeLlm,
      preferInSandbox,
      ...(input.signal ? { signal: input.signal } : {}),
    })

    if (result.inSandbox) {
      return {
        ...(await reportFromInSandbox(result, context, includeLlm)),
        context,
      }
    }

    const files = result.files ?? []
    const scanned = await runSkillScan(
      { files, source: result.source, truncated: result.truncated,
        ...(result.truncatedReason ? { truncatedReason: result.truncatedReason } : {}) },
      { context },
      { review: reviewer(includeLlm) }
    )
    return { ...scanned, context }
  } catch (error) {
    if (!preferInSandbox || !(error instanceof InSandboxScriptError)) throw error

    console.warn("[egress-scan] in-sandbox scan failed; falling back to serverless", error)
    const result = await scanRepository({
      repoFullName: input.repoFullName,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(input.skillDir ? { skillDir: input.skillDir } : {}),
      includeLlm,
      preferInSandbox: false,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    const files = result.files ?? []
    const scanned = await runSkillScan(
      { files, source: result.source, truncated: result.truncated,
        ...(result.truncatedReason ? { truncatedReason: result.truncatedReason } : {}) },
      { context },
      { review: reviewer(includeLlm) }
    )
    return { ...scanned, context }
  }
}

async function reportFromInSandbox(
  result: SandboxScanResult,
  context: ScanContext,
  includeLlm: boolean
): Promise<SkillScanReport> {
  if (!result.inSandbox) {
    throw new InSandboxScriptError("no in-sandbox result")
  }
  const ruleGrade = result.inSandbox.grade as SecurityGrade
  const flags = result.inSandbox.flags as SecurityFlagHit[]
  const files: SkillSourceFile[] = (result.inSandbox.files ?? [])
    .filter((file): file is { path: string; size: number; content: string } =>
      typeof file.content === "string"
    )
    .map((file) => ({ path: file.path, content: file.content, size: file.size }))

  let llmGrade: SecurityGrade | undefined
  let llmAnalysis: LlmAnalysis | undefined
  if (includeLlm) {
    const analysis = await analyzeWithLlm(files, flags, ruleGrade)
    llmAnalysis = analysis ?? LLM_UNAVAILABLE
    llmGrade = analysis?.grade
  }

  return {
    grade: mergeGrades(ruleGrade, llmGrade ?? null),
    flags,
    trustTier: result.inSandbox.trustTier as 1 | 2 | 3 | 4 | 5,
    ...(llmGrade ? { llmGrade } : {}),
    ...(llmAnalysis ? { llmAnalysis } : {}),
    scannedAt: new Date().toISOString(),
    rulesVersion: SCAN_RULES_VERSION,
    fileCount: result.inSandbox.fileCount,
    source: result.source,
    truncated: result.truncated,
    ...(result.truncatedReason ? { truncatedReason: result.truncatedReason } : {}),
    files: (result.inSandbox.files ?? []).map((file) => ({ path: file.path, size: file.size })),
  }
}

function reviewer(includeLlm: boolean) {
  return includeLlm ? undefined : null
}

function withOwner(context: ScanContext | undefined, input: SkillScanInput): ScanContext {
  const owner = context?.owner ?? input.repoFullName.split("/")[0] ?? null
  return { ...context, owner }
}