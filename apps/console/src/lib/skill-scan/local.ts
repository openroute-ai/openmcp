/**
 * The non-Vercel path: `git clone`, read, delete.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * - `--depth=1 --no-checkout`, then an explicit `git checkout`. Without the
 *   second step a shallow clone sits on a detached HEAD with no working tree, the
 *   walk finds nothing, and the scan reports a repository as clean. That is the
 *   worst failure available here, and it is silent.
 * - A missing `ref` is not a reason to fail. It falls back to the default
 *   branch: the caller asking for a branch that no longer exists is asking about
 *   a repository that moved on, and answering "we could not check it out" would
 *   be worse than answering about `main`.
 */
import { execFile } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { randomBytes } from "node:crypto"
import type { SkillSourceSnapshot } from "@workspace/security-scan"
import { skillScanLimits, scanTmpDir } from "./env"
import { InvalidSkillDirError, SkillSourceUnavailableError } from "./errors"
import { collectFiles, nodeFileLister } from "./walk"

const execFileAsync = promisify(execFile)

export interface LocalCloneRequest {
  repoFullName: string
  ref?: string
  skillDir?: string
  signal?: AbortSignal
}

/**
 * Public repositories only.
 *
 * The clone URL carries no credential, on purpose: a token interpolated into a
 * URL is visible in `ps` for the life of the clone and lands in any error that
 * echoes the command. Private repositories therefore fail loudly rather than
 * silently scanning an empty checkout — see
 * `docs/design/SKILL_SECURITY_SCAN_PIPELINE.md` §8.
 */
export async function cloneAndCollect(
  request: LocalCloneRequest
): Promise<SkillSourceSnapshot> {
  const { cloneDir, cleanup } = await checkout(request)
  try {
    const base = resolveBase(cloneDir, request.skillDir)
    const walked = await collectFiles(nodeFileLister, base, skillScanLimits())
    return {
      files: walked.files,
      source: "local-clone",
      truncated: walked.truncated,
      ...(walked.truncatedReason ? { truncatedReason: walked.truncatedReason } : {}),
    }
  } finally {
    // A single checkout is disposable: nothing downstream reads it. Keeping it
    // would rely on the daily sweep to reclaim a directory this process already
    // knows is dead — the sweep exists for the case where the process dies
    // between clone and here, not for the normal path.
    await cleanup()
  }
}

/**
 * `skillDir` must stay inside the checkout.
 *
 * `../../etc` in a request body is not a path, it is a file disclosure — the walk
 * would read the host's filesystem and hand it to the reviewer. Resolved and
 * compared, not pattern-matched: `skills/../../..` defeats a regex.
 */
export function resolveBase(cloneDir: string, skillDir: string | undefined): string {
  if (!skillDir) return cloneDir
  const root = resolve(cloneDir)
  const base = resolve(root, skillDir)
  if (base !== root && !base.startsWith(root + sep)) {
    throw new InvalidSkillDirError("skillDir must stay inside the repository")
  }
  return base
}

/**
 * Clone into a fresh directory under the configured tmp root.
 *
 * The random suffix is not there for uniqueness of the *repository* — it is so
 * two concurrent scans of the same repo cannot share a working tree. Sharing one
 * is the kind of bug that only shows up under load, and then it reports a clean
 * result for a checkout somebody else is writing to.
 */
async function checkout(request: LocalCloneRequest) {
  await mkdir(scanTmpDir(), { recursive: true })
  const cloneDir = join(
    scanTmpDir(),
    `${cloneDirName(request.repoFullName)}-${randomBytes(6).toString("hex")}`
  )

  const cleanup = async () => {
    await rm(cloneDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth=1",
        "--no-checkout",
        "--single-branch",
        `https://github.com/${request.repoFullName}.git`,
        cloneDir,
      ],
      { signal: request.signal, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    )
  } catch (error) {
    await cleanup()
    throw new SkillSourceUnavailableError(
      `cannot fetch ${request.repoFullName} from GitHub (public repositories only)`,
      error
    )
  }

  try {
    if (request.ref) {
      try {
        await execFileAsync("git", ["-C", cloneDir, "checkout", request.ref], {
          signal: request.signal,
          timeout: 60_000,
        })
        return { cloneDir, cleanup }
      } catch {
        // Fall through to the default branch. See the header.
      }
    }
    await execFileAsync("git", ["-C", cloneDir, "checkout"], {
      signal: request.signal,
      timeout: 60_000,
    })
  } catch (error) {
    await cleanup()
    throw new SkillSourceUnavailableError(
      `cannot check out ${request.repoFullName}${request.ref ? `@${request.ref}` : ""}`,
      error
    )
  }

  return { cloneDir, cleanup }
}

function cloneDirName(repoFullName: string): string {
  return repoFullName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo"
}