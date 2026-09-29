/**
 * SKILL.md fetching and parsing.
 *
 * A project is either a single skill at one path, or a directory of skills
 * where each subdirectory holds its own SKILL.md.
 */

import { createHash } from "node:crypto"
import matter from "gray-matter"
import type { GitHubClient } from "@/lib/github/client"

export interface ParsedSkill {
  name: string
  description: string
  version: string | null
  readme: string
}

/**
 * Only the exact value `skills` means directory mode.
 *
 * A path of `skills/` is treated the same after the trailing slash is
 * trimmed. Any other value is a specific file, including one that merely
 * starts with "skills" such as `skills.md`.
 */
export function isSkillDirMode(skillMdPath: string): boolean {
  return skillMdPath.trim().replace(/\/$/, "") === "skills"
}

/** Fetches a skill's document from a repository. */
export async function fetchSkillMd(
  client: GitHubClient,
  fullName: string,
  path: string,
  ref?: string
): Promise<string> {
  return client.fetchFileContent(fullName, path, ref)
}

/** The subdirectory names under a path, for one repository of many skills. */
export async function listSkillDirs(
  client: GitHubClient,
  fullName: string,
  path: string,
  ref?: string
): Promise<string[]> {
  const entries = await client.listDirectory(fullName, path, ref)
  return entries
    .filter((entry) => entry.type === "dir")
    .map((entry) => entry.name)
}

/**
 * The path of a skill's SKILL.md inside a directory-mode repository.
 */
export function skillPathInDir(skillsPath: string, dir: string): string {
  const base = skillsPath.trim().replace(/\/$/, "")
  return `${base}/${dir}/SKILL.md`
}

/**
 * Splits frontmatter from the body.
 *
 * A skill with no frontmatter still parses: the body becomes the readme and
 * the name falls back, rather than the whole document being rejected.
 */
export function parseSkillMd(raw: string): ParsedSkill {
  const { data: front, content } = matter(raw)

  const name = typeof front?.name === "string" ? front.name.trim() : ""
  const description =
    typeof front?.description === "string" ? front.description.trim() : ""

  // The version has lived in two places across revisions of the skill
  // format, so both are accepted rather than one silently reading as absent.
  const metadata = front?.metadata as { version?: unknown } | undefined
  const version =
    typeof metadata?.version === "string"
      ? metadata.version.trim()
      : typeof front?.version === "string"
        ? front.version.trim()
        : null

  return {
    name: name || "Skill",
    description,
    version: version || null,
    readme: content?.trim() ?? "",
  }
}

/**
 * A stable fingerprint of the raw document, for change detection.
 *
 * SHA-256 rather than a short non-cryptographic hash: this decides whether a
 * skill is re-translated and re-pushed, and a 32-bit hash collides often
 * enough on real documents to skip a genuine change.
 */
export function contentHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex")
}
