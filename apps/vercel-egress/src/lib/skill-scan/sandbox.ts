/**
 * Route B 的取源：把仓库拉进一个沙箱，然后在两种模式之一里求值。
 *
 * - `sandbox` — 规则在沙箱**内部**跑，仓库源码不出沙箱。
 * - `serverless` — 沙箱只是文件系统，文件读回来在函数里跑同一套规则。
 *
 * 与 `apps/console/src/lib/skill-scan/sandbox.ts` 同源（上游是同一个
 * `@workspace/security-scan` 与 `@vercel/sandbox`）；部署目标不同所以独立成模块，
 * 不再经过 `isVercelRuntime()` 判定——这里永远是 Vercel。
 */
import type { Sandbox } from "@vercel/sandbox"
import {
  buildSandboxScanScript,
  DEFAULT_FILE_PICKER_LIMITS,
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
} from "../../env"
import { InvalidSkillDirError, SkillSourceUnavailableError } from "./errors"
import { collectFiles, type FileLister } from "./walk"

const SANDBOX_REPO_ROOT = "/vercel/sandbox"

export interface SandboxScanRequest {
  repoFullName: string
  ref?: string
  skillDir?: string
  includeLlm: boolean
  preferInSandbox: boolean
  signal?: AbortSignal
}

export interface SandboxScanResult {
  inSandbox?: SandboxScanOutput
  files?: SkillSourceFile[]
  truncated: boolean
  truncatedReason?: string
  source: SkillScanSource
}

export class InSandboxScriptError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "InSandboxScriptError"
  }
}

export async function scanRepository(
  request: SandboxScanRequest
): Promise<SandboxScanResult> {
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
    throw new InSandboxScriptError(
      "in-sandbox scanner did not run to completion",
      error
    )
  }

  let stdout: string
  let stderr: string
  try {
    stdout = await result.stdout()
    stderr = await result.stderr()
  } catch (error) {
    throw new InSandboxScriptError("could not read in-sandbox scanner output", error)
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
      return sandbox.fs.readFile(
        path,
        signal ? { encoding: null, signal } : null
      )
    },
  }
  return collectFiles(lister, base, limits)
}

export function resolveSandboxBase(skillDir: string | undefined): string {
  if (!skillDir) return SANDBOX_REPO_ROOT
  const base = resolveInside(SANDBOX_REPO_ROOT, skillDir)
  if (base === SANDBOX_REPO_ROOT || base.startsWith(`${SANDBOX_REPO_ROOT}/`)) return base
  throw new InvalidSkillDirError("skillDir must stay inside the repository")
}

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

async function release(sandbox: Sandbox): Promise<void> {
  await sandbox.stop().catch(() => {})
  await sandbox.delete().catch(() => {})
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)
  return line ? line.trim().slice(0, 300) : ""
}

function skillScanLimits(): FilePickerLimits {
  return {
    maxFiles:
      positiveInt(process.env.SKILL_SCAN_MAX_FILES) ??
      DEFAULT_FILE_PICKER_LIMITS.maxFiles,
    maxTotalBytes:
      positiveInt(process.env.SKILL_SCAN_MAX_TOTAL_BYTES) ??
      DEFAULT_FILE_PICKER_LIMITS.maxTotalBytes,
    maxFileBytes:
      positiveInt(process.env.SKILL_SCAN_MAX_FILE_BYTES) ??
      DEFAULT_FILE_PICKER_LIMITS.maxFileBytes,
  }
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}