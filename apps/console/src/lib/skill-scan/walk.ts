/**
 * The walk, over a real filesystem. Used by the local-clone path, and by the
 * serverless Vercel path when `sandbox.fs` is the only thing that can list a
 * directory.
 *
 * The decision of *which* files to read is not here — `isScannablePath` and
 * `acceptFile` from the package own it. This module only supplies bytes and
 * paths, so the local path and the sandbox path cannot drift on what counts as
 * scannable.
 */
import { readFile, readdir, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import {
  acceptFile,
  isBinaryBytes,
  isScannablePath,
  type FilePickerLimits,
} from "@workspace/security-scan"
import type { SkillSourceFile } from "@workspace/security-scan"

/** A source of directory entries, so both a real FS and `sandbox.fs` fit. */
export interface FileLister {
  readdir(dir: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>>
  stat(path: string): Promise<{ size: number }>
  readFile(path: string): Promise<Uint8Array>
}

export interface WalkResult {
  files: SkillSourceFile[]
  truncated: boolean
  truncatedReason?: string
}

/** The walk's only early exit: a cap was hit, so the result is a partial read. */
interface Stopped {
  truncated: true
  truncatedReason: "max_files" | "max_total_bytes" | "file_too_large"
}

/**
 * Walk `root` depth-first, applying the shared picker.
 *
 * Directory entries come back in whatever order the source gives them, which is
 * alphabetical on ext4 and arbitrary on `sandbox.fs`. That does not matter for
 * the verdict, and sorting would only hide which of two equally-scanned
 * repositories happened to hit the file cap first.
 */
export async function collectFiles(
  lister: FileLister,
  root: string,
  limits: FilePickerLimits
): Promise<WalkResult> {
  const files: SkillSourceFile[] = []
  let bytes = 0

  const walk = async (dir: string): Promise<Stopped | null> => {
    const entries = await lister.readdir(dir)
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory) {
        const stopped = await walk(full)
        if (stopped) return stopped
        continue
      }
      if (!entry.isFile) continue

      const rel = relativePosix(root, full)
      if (!isScannablePath(rel)) continue

      const stats = await lister.stat(full)
      const decision = acceptFile(limits, { count: files.length, bytes }, rel, stats.size)
      if (!decision.ok) {
        return { truncated: true, truncatedReason: decision.reason }
      }

      const raw = await lister.readFile(full)
      if (isBinaryBytes(raw)) continue

      files.push({ path: rel, content: Buffer.from(raw).toString("utf8"), size: raw.length })
      bytes += raw.length
    }
    return null
  }

  const stopped = await walk(root)
  return stopped
    ? { files, ...stopped }
    : { files, truncated: false }
}

/** Node's `relative` uses `\` on Windows; every path in a snapshot is POSIX. */
function relativePosix(from: string, to: string): string {
  return relative(from, to).split(sep).join("/")
}

/** {@link FileLister} over `node:fs`. */
export const nodeFileLister: FileLister = {
  async readdir(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }))
  },
  async stat(path) {
    return stat(path)
  },
  async readFile(path) {
    return readFile(path)
  },
}