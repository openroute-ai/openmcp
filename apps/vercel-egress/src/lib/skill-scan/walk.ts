/**
 * The walk, over `sandbox.fs`. Used when Route B needs to read a repository
 * back from the sandbox (`serverless` mode) instead of running the rules inside
 * it.
 *
 * The decision of *which* files to read is not here — `isScannablePath` and
 * `acceptFile` from `@workspace/security-scan` own it. This module only
 * supplies bytes and paths, so it cannot drift on what counts as scannable.
 */
import { join, relative, sep } from "node:path"
import {
  acceptFile,
  isBinaryBytes,
  isScannablePath,
  type FilePickerLimits,
  type SkillSourceFile,
} from "@workspace/security-scan"

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

interface Stopped {
  truncated: true
  truncatedReason: "max_files" | "max_total_bytes" | "file_too_large"
}

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
  return stopped ? { files, ...stopped } : { files, truncated: false }
}

function relativePosix(from: string, to: string): string {
  return relative(from, to).split(sep).join("/")
}