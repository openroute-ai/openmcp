/**
 * Where the scan runs, and with what budget.
 *
 * The deployment target decides this, not the caller: a Vercel function cannot
 * `git clone` (read-only filesystem, and the function budget is measured in
 * seconds), while a long-lived Node process can and should. Encoding the
 * difference here — rather than at the call site — is what keeps the route from
 * growing a `if (isVercel)` in every branch.
 */
import {
  DEFAULT_FILE_PICKER_LIMITS,
  type FilePickerLimits,
} from "@workspace/security-scan"

/**
 * True on Vercel, whether or not the sandbox is the intended path.
 *
 * `VERCEL === "1"` is the documented value; `VERCEL_ENV` is present on every
 * Vercel invocation including `vercel dev`. Either is enough, and neither is
 * present anywhere else — which matters, because `vercel dev` runs on a laptop
 * and must still be treated as Vercel, or a developer would silently exercise a
 * code path their deployment never takes.
 */
export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV)
}

/**
 * On Vercel, where the rules are evaluated.
 *
 * - `sandbox` — inside the sandbox, on the box that already has the checkout.
 *   Content never leaves unless the LLM stage asks for it.
 * - `serverless` — the sandbox is only a filesystem; files come back and the
 *   rules run here.
 *
 * Defaults to `sandbox`. An unrecognised value falls back to `serverless`
 * rather than being trusted: it is the mode that does not execute generated
 * source, and a typo in an env var should cost throughput, not correctness.
 */
export type VercelScanMode = "sandbox" | "serverless"

export function vercelScanMode(): VercelScanMode {
  const raw = process.env.SKILL_SCAN_VERCEL_MODE?.trim().toLowerCase()
  if (!raw) return "sandbox"
  if (raw === "sandbox" || raw === "serverless") return raw
  console.warn(
    `[skill-scan] unknown SKILL_SCAN_VERCEL_MODE=${JSON.stringify(raw)}; using "serverless"`
  )
  return "serverless"
}

/** The scan's file budget. Overridable so a large private repo can be opted in. */
export function skillScanLimits(): FilePickerLimits {
  return {
    maxFiles: positiveInt(process.env.SKILL_SCAN_MAX_FILES) ?? DEFAULT_FILE_PICKER_LIMITS.maxFiles,
    maxTotalBytes:
      positiveInt(process.env.SKILL_SCAN_MAX_TOTAL_BYTES) ??
      DEFAULT_FILE_PICKER_LIMITS.maxTotalBytes,
    maxFileBytes:
      positiveInt(process.env.SKILL_SCAN_MAX_FILE_BYTES) ??
      DEFAULT_FILE_PICKER_LIMITS.maxFileBytes,
  }
}

/**
 * Sandbox lifetime, in milliseconds.
 *
 * Covers clone, walk and (mode `sandbox`) one `node` invocation. Default 120 s
 * because the route's own `maxDuration` is 300 s and a sandbox that outlives its
 * function is billed for nothing.
 */
export function sandboxTimeoutMs(): number {
  return positiveInt(process.env.SKILL_SCAN_SANDBOX_TIMEOUT_MS) ?? 120_000
}

/** Cap on the in-sandbox `node` invocation itself, so a hung read cannot eat it all. */
export function sandboxCommandTimeoutMs(): number {
  return positiveInt(process.env.SKILL_SCAN_COMMAND_TIMEOUT_MS) ?? 60_000
}

/**
 * vCPUs for the sandbox.
 *
 * The work is IO plus a handful of regex passes over a few MiB — no parallelism
 * to buy. Default 1 keeps the per-request cost of scanning a repository at the
 * price of scanning a file.
 */
export function sandboxVcpus(): number {
  return positiveInt(process.env.SKILL_SCAN_SANDBOX_VCPUS) ?? 1
}

/** Where the local-clone path puts checkouts. */
export function scanTmpDir(): string {
  return process.env.SKILL_SCAN_TMP_DIR?.trim() || "/tmp/skills-scan"
}

/** How old a local checkout may get before the daily task removes it. */
export function tmpDirMaxAgeMs(): number {
  const hours = positiveInt(process.env.SKILL_SCAN_TMP_MAX_AGE_HOURS) ?? 24
  return hours * 60 * 60 * 1000
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}