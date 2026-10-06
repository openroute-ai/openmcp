/**
 * The Vercel path. Two modes over one sandbox:
 *
 * - `sandbox` — the rules run *inside* the sandbox, on the box that already has
 *   the checkout, and come back as a grade plus a manifest. Repository source
 *   never crosses the network.
 * - `serverless` — the sandbox is only a filesystem. Files are listed and read
 *   over `sandbox.fs`, and the rules run in this function.
 *
 * They exist because the first is cheaper and the second is the one that can
 * serve the reviewer. {@link scanRepository} picks between them by whether the
 * caller wants stage 2, so a caller never has to know which is available — and
 * the mode reported back says which actually ran.
 */
import type { Sandbox } from "@vercel/sandbox"
import {
  buildSandboxScanScript,
  parseSandboxScanOutput,
  type FilePickerLimits,
  type SandboxScanOutput,
  type SkillScanSource,
  type SkillSourceFile,
} from "@workspace/security-scan"
import {
  sandboxCommandTimeoutMs,
  sandboxTimeoutMs,
  sandboxVcpus,
  skillScanLimits,
} from "./env"
import { InvalidSkillDirError, SkillSourceUnavailableError } from "./errors"
import { collectFiles, type FileLister } from "./walk"

/** `/vercel/sandbox` is the sandbox cwd, and where a git source is checked out. */
const SANDBOX_REPO_ROOT = "/vercel/sandbox"

export interface SandboxScanRequest {
  repoFullName: string
  ref?: string
  skillDir?: string
  /**
   * Whether the caller needs stage 2. A request for stage 2 asks the script to
   * piggyback file contents, because the reviewer runs here, not in the sandbox.
   */
  includeLlm: boolean
  /**
   * Prefer running the rules inside the sandbox. False reads files back and runs
   * the same rules in this function — the `serverless` mode.
   */
  preferInSandbox: boolean
  signal?: AbortSignal
}

export interface SandboxScanResult {
  /** Present when the rules ran inside the sandbox. */
  inSandbox?: SandboxScanOutput
  /**
   * Files that came back, either read over `sandbox.fs` or emitted by the script.
   * With `includeLlm` the contents are present; otherwise absent (see the type).
   */
  files?: SkillSourceFile[]
  truncated: boolean
  truncatedReason?: string
  source: SkillScanSource
}

/**
 * The in-sandbox execution itself broke — script error, image change, crash.
 *
 * Deliberately distinct from "the repository could not be fetched": the caller
 * falls back to read-and-scan-locally on this one and must not on the other.
 */
export class InSandboxScriptError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "InSandboxScriptError"
  }
}

/**
 * Fetches the repository into a fresh sandbox and evaluates the rules.
 *
 * Every exit path stops and deletes the sandbox. A leaked sandbox is billed until
 * it times out, and `timeout` is a backstop rather than a cleanup strategy — under
 * a concurrent sweep the leaked minutes accumulate.
 */
export async function scanRepository(request: SandboxScanRequest): Promise<SandboxScanResult> {
  const { Sandbox: VercelSandbox } = await import("@vercel/sandbox")

  const limits = skillScanLimits()
  const base = resolveSandboxBase(request.skillDir)

  let sandbox: Sandbox
  try {
    sandbox = await VercelSandbox.create({
      source: {
        type: "git",
        url: `https://github.com/${request.repoFullName}.git`,
        depth: 1,
        ...(request.ref ? { revision: request.ref } : {}),
      },
      timeout: sandboxTimeoutMs(),
      resources: { vcpus: sandboxVcpus() },
      ...(request.signal ? { signal: request.signal } : {}),
    })
  } catch (error) {
    throw new SkillSourceUnavailableError(
      `cannot create a sandbox for ${request.repoFullName}`,
      error
    )
  }

  try {
    if (request.preferInSandbox) {
      const output = await runInSandbox(sandbox, request, base, limits)
      return {
        inSandbox: output,
        files: output.files as SkillSourceFile[] | undefined,
        truncated: output.truncated,
        ...(output.truncatedReason ? { truncatedReason: output.truncatedReason } : {}),
        source: "vercel-sandbox",
      }
    }

    const walked = await readBack(sandbox, base, limits, request.signal)
    return {
      files: walked.files,
      truncated: walked.truncated,
      ...(walked.truncatedReason ? { truncatedReason: walked.truncatedReason } : {}),
      source: "vercel-sandbox-serverless",
    }
  } finally {
    await release(sandbox)
  }
}

/**
 * Write the generated scanner and run it.
 *
 * `.cjs` on purpose: the script uses `require`, and the sandbox image's Node
 * version is not pinned, so a `.js` name would be at the mercy of whatever
 * `"type": "module"` happens to sit above it.
 */
async function runInSandbox(
  sandbox: Sandbox,
  request: SandboxScanRequest,
  base: string,
  limits: FilePickerLimits
): Promise<SandboxScanOutput> {
  const scriptPath = "/tmp/openmcp-scan.cjs"
  await sandbox.fs.writeFile(
    scriptPath,
    buildSandboxScanScript({
      basePath: base,
      limits,
      // Stage 2 needs the contents, and they travel with the manifest in one
      // output. Without it the script emits paths only and the repository's
      // source never crosses the network.
      includeContent: request.includeLlm,
    })
  )

  let result: Awaited<ReturnType<Sandbox["runCommand"]>>
  try {
    result = await sandbox.runCommand("node", [scriptPath], {
      timeoutMs: sandboxCommandTimeoutMs(),
      ...(request.signal ? { signal: request.signal } : {}),
    })
  } catch (error) {
    // `runCommand` rejecting — timeout, session lost — is the same category as a
    // script that throws: the in-sandbox execution did not produce a verdict.
    throw new InSandboxScriptError("in-sandbox scanner did not run to completion", error)
  }

  let stdout: string
  let stderr: string
  try {
    // Both streams reach the parser: a stack trace lands on stderr, so a script
    // that throws would otherwise look exactly like one that produced no result —
    // which is also what a wrong `basePath` produces.
    stdout = await result.stdout()
    stderr = await result.stderr()
  } catch (error) {
    throw new InSandboxScriptError(
      "could not read in-sandbox scanner output",
      error
    )
  }

  try {
    return parseSandboxScanOutput(`${stdout}\n${stderr}`)
  } catch (error) {
    const detail = firstLine(stderr) || firstLine(stdout) || "no output"
    throw new InSandboxScriptError(
      `in-sandbox scanner failed (exit ${result.exitCode}): ${detail}`,
      error
    )
  }
}

/** {@link FileLister} over `sandbox.fs`. */
async function readBack(
  sandbox: Sandbox,
  base: string,
  limits: FilePickerLimits,
  signal: AbortSignal | undefined
): Promise<{ files: SkillSourceFile[]; truncated: boolean; truncatedReason?: string }> {
  const lister: FileLister = {
    async readdir(dir) {
      const entries = await sandbox.fs.readdir(dir, {
        withFileTypes: true,
        ...(signal ? { signal } : {}),
      })
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }))
    },
    async stat(path) {
      return sandbox.fs.stat(path, signal ? { signal } : {})
    },
    async readFile(path) {
      // `encoding: null` asks for bytes; the binary check needs them before any
      // decoding happens. The signal travels in the options object.
      return sandbox.fs.readFile(
        path,
        signal ? { encoding: null, signal } : null
      )
    },
  }
  return collectFiles(lister, base, limits)
}

/**
 * `skillDir` resolved inside the sandbox, containment-checked.
 *
 * Same reason as the local path: a request body is untrusted input, and the walk
 * would otherwise read whatever the sandbox can see.
 */
export function resolveSandboxBase(skillDir: string | undefined): string {
  if (!skillDir) return SANDBOX_REPO_ROOT
  const base = resolveInside(SANDBOX_REPO_ROOT, skillDir)
  if (base === SANDBOX_REPO_ROOT || base.startsWith(`${SANDBOX_REPO_ROOT}/`)) return base
  throw new InvalidSkillDirError("skillDir must stay inside the repository")
}

/** POSIX-only normalisation; `path` on the server may be win32. */
function resolveInside(root: string, relativePath: string): string {
  const segments: string[] = []
  for (const segment of `${root}/${relativePath}`.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join("/")}`
}

/**
 * Stop, then delete — swallowing both.
 *
 * `stop` first because `delete` can race a still-running session, and a `finally`
 * that throws replaces the real error with a cleanup error, which is how "the scan
 * failed" turns into "the sandbox delete failed" in the logs.
 */
async function release(sandbox: Sandbox): Promise<void> {
  await sandbox.stop().catch(() => {})
  await sandbox.delete().catch(() => {})
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)
  return line ? line.trim().slice(0, 300) : ""
}