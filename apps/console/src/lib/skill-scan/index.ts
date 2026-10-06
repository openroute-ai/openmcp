/**
 * Where the scan runs, and what comes back.
 *
 * The dispatcher is the whole point of this module: the route asks for "a scan
 * of this repository", and everything about *how* — Vercel or not, sandbox or
 * serverless, one sandbox or a clone — is settled here and reported back in
 * `source`. A caller can reason about where a verdict came from without a single
 * environment check of its own.
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
import { scanTmpDir, tmpDirMaxAgeMs, vercelScanMode, isVercelRuntime } from "./env"
import { cloneAndCollect } from "./local"
import { InSandboxScriptError, scanRepository, type SandboxScanResult } from "./sandbox"

export { InvalidSkillDirError, SkillSourceUnavailableError } from "./errors"
export { InSandboxScriptError } from "./sandbox"
export { isVercelRuntime, vercelScanMode, type VercelScanMode } from "./env"

export interface SkillScanInput {
  repoFullName: string
  ref?: string
  skillDir?: string
  /** The repository's owner, used only as trust context when none is supplied. */
  owner?: string
  context?: ScanContext
  /** Stage 2. Default true. */
  includeLlm?: boolean
  signal?: AbortSignal
}

/**
 * Fetches the source and runs both stages.
 *
 * `includeLlm` is the caller's only knob, and it does two jobs: it decides
 * whether stage 2 runs, and — because the reviewer runs here, not in the sandbox
 * — it controls whether the scan's output carries file contents. The mode is a
 * deployment setting, decided by `SKILL_SCAN_VERCEL_MODE`, and the caller never
 * sees it.
 */
export async function scanRepositoryWithReview(
  input: SkillScanInput
): Promise<SkillScanReport & { context: ScanContext }> {
  const includeLlm = input.includeLlm !== false
  const context = withOwner(input.context, input)

  if (isVercelRuntime()) {
    return runOnVercel(input, context, includeLlm)
  }
  return runLocally(input, context, includeLlm)
}

async function runLocally(
  input: SkillScanInput,
  context: ScanContext,
  includeLlm: boolean
): Promise<SkillScanReport & { context: ScanContext }> {
  const snapshot = await cloneAndCollect({
    repoFullName: input.repoFullName,
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.skillDir ? { skillDir: input.skillDir } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })
  const scanned = await runSkillScan(snapshot, { context }, { review: reviewer(includeLlm) })
  return { ...scanned, context }
}

/**
 * The Vercel path, with a fallback.
 *
 * `sandbox` mode runs the rules inside the sandbox. If that fails — the script
 * broke, the image changed, the checkout moved — the request falls back to
 * reading the files back and running the same rules here. The fallback is what
 * makes the default mode safe to leave on: a broken fast path costs latency, not
 * availability.
 *
 * The reverse is not attempted: a failed read-back is the box refusing to serve
 * files, and re-running it would fail the same way.
 */
async function runOnVercel(
  input: SkillScanInput,
  context: ScanContext,
  includeLlm: boolean
): Promise<SkillScanReport & { context: ScanContext }> {
  const preferInSandbox = vercelScanMode() === "sandbox"

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
    // Only in-sandbox script failures have a fallback. A repository that cannot
    // be fetched, a sandbox that cannot be created, an invalid `skillDir` all
    // fail identically on the read-back path, so re-running them is wasted work.
    if (!preferInSandbox || !(error instanceof InSandboxScriptError)) throw error

    console.warn("[skill-scan] in-sandbox scan failed; falling back to serverless", error)
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

/**
 * The in-sandbox report, merging stage 2 when it was asked for.
 *
 * The rules already ran in the sandbox, so stage 2 only needs the reviewer to
 * argue with their verdict — no second rule pass. `llmGrade` is absent exactly
 * when stage 2 was skipped, which reads as "not reviewed", which is the truth.
 */
async function reportFromInSandbox(
  result: SandboxScanResult,
  context: ScanContext,
  includeLlm: boolean
): Promise<SkillScanReport> {
  if (!result.inSandbox) {
    // The caller guards on this field; the branch exists so the type system can
    // prove the function's contract, not because it is reachable.
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
    // `analyzeWithLlm` never throws: no key means `null`, which is recorded as
    // "review unavailable" rather than silently treated as "reviewed, fine".
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

/** `undefined` runs the packaged reviewer; `null` skips it. */
function reviewer(includeLlm: boolean) {
  return includeLlm ? undefined : null
}

function withOwner(context: ScanContext | undefined, input: SkillScanInput): ScanContext {
  const owner = input.owner ?? context?.owner ?? input.repoFullName.split("/")[0] ?? null
  return { ...context, owner }
}

/**
 * Removes local checkouts older than the configured age.
 *
 * A safety net, not the plan: {@link cloneAndCollect} deletes its own checkout,
 * and only a process dying between clone and that `finally` leaves one behind.
 * The daily `cleanup-skill-scan-tmp` task calls it and gets back how many
 * directories it removed, so the task logs something other than "done".
 */
export async function cleanupOldSkillScanDirs(maxAgeMs = tmpDirMaxAgeMs()): Promise<number> {
  const { readdir, rm, stat } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const base = scanTmpDir()
  let removed = 0
  try {
    const entries = await readdir(base, { withFileTypes: true })
    const cutoff = Date.now() - maxAgeMs
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = join(base, entry.name)
      try {
        const stats = await stat(full)
        if (stats.mtimeMs < cutoff) {
          await rm(full, { recursive: true, force: true })
          removed++
        }
      } catch {
        // A directory that vanished mid-sweep was already removed by whoever
        // created it; that is the outcome we wanted.
      }
    }
  } catch {
    // No tmp root yet means nothing has ever been cloned.
  }
  return removed
}