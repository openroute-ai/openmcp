/**
 * SKILL.md fetching and parsing.
 *
 * A project's `skillMdPath` names one path, and that path is either a single
 * document or a directory holding one per skill. Which of the two it is belongs
 * to the repository rather than to the name: `skills`, `.agents/skills` and
 * `packages/skills` are all the second kind, and `SKILL.md` is the first. So the
 * shape is read from GitHub instead of being matched against the string — a
 * match can only ever recognise the layouts it was told about, and every layout
 * it does not recognise fails as though the repository were broken.
 */

import { createHash } from "node:crypto"
import matter from "gray-matter"
import { GitHubNotFoundError } from "@/lib/github/errors"
import type { GitHubClient } from "@/lib/github/client"

export interface ParsedSkill {
  name: string
  description: string
  version: string | null
  readme: string
}

/** The documents a project's path turned out to hold. */
export type SkillSource =
  { mode: "file"; raw: string } | { mode: "directory"; dirs: string[] }

/**
 * Resolves the configured path to the documents it holds.
 *
 * `null` means the path is not in the repository. That is a state, not a failed
 * fetch: a rate limit or a dropped connection is worth retrying, while a path
 * that is absent will still be absent on the next run. Reporting the two the
 * same way is what makes a permanently empty project look like an outage.
 */
export async function readSkillSource(
  client: GitHubClient,
  fullName: string,
  path: string,
  ref?: string
): Promise<SkillSource | null> {
  let content
  try {
    content = await client.readPath(fullName, path, ref)
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return null
    throw error
  }

  if (content.kind === "file") return { mode: "file", raw: content.content }

  return {
    mode: "directory",
    dirs: content.entries
      .filter((entry) => entry.type === "dir")
      .map((entry) => entry.name),
  }
}

/**
 * Where a repository's skills live, once its own layout has been read.
 *
 * `path` is what goes back into `projects.skillMdPath`, so it is a path the
 * Contents API can be asked for again — a root directory, or the single document
 * itself.
 */
export interface SkillRoot {
  path: string
  mode: "file" | "directory"
  /** How many documents it accounts for, for the log line that explains it. */
  documents: number
}

/**
 * Picks where a repository keeps its skills, from the paths of the documents
 * themselves.
 *
 * A collection is a directory whose children each hold a skill, so the candidate
 * for a document is the directory *above* its own: `.agents/skills/ai-sdk/SKILL.md`
 * is evidence for `.agents/skills`, not for `.agents/skills/ai-sdk`. Candidates
 * are then ranked:
 *
 * 1. **Most documents directly beneath them.** Skills live together, so the
 *    biggest cluster is the collection and anything smaller is a nested layout,
 *    an example, or a fixture that happens to ship one.
 * 2. **Shallowest**, for a repository that scatters its skills one per directory.
 * 3. **Alphabetically first**, so two runs over the same repository cannot
 *    disagree about where its skills are.
 *
 * A document that sits in the repository root wins outright — a repository
 * keeping one document there is in single-document mode even if it also ships
 * examples deeper down. A lone document in a directory (`skills/SKILL.md`) is the
 * same case: that directory cannot be a collection, because nothing is beneath
 * it, so the document itself is the answer rather than a directory that would
 * resolve to zero skills.
 *
 * `null` means there is nothing to find, which the caller reports as an empty
 * discovery rather than as a failure.
 */
export function skillRootFromPaths(paths: readonly string[]): SkillRoot | null {
  if (paths.length === 0) return null
  if (paths.includes("SKILL.md")) {
    return { path: "SKILL.md", mode: "file", documents: 1 }
  }

  // Candidate collection -> the documents directly beneath it, so a skill one
  // level further down does not make its parent's cluster look larger than the
  // collection it actually belongs to.
  const clusters = new Map<string, string[]>()
  for (const path of paths) {
    const slash = path.lastIndexOf("/")
    if (slash <= 0) continue
    const skillDir = path.slice(0, slash)
    const parentSlash = skillDir.lastIndexOf("/")
    const collection = parentSlash > 0 ? skillDir.slice(0, parentSlash) : ""
    const existing = clusters.get(collection)
    if (existing) existing.push(path)
    else clusters.set(collection, [path])
  }

  let best: { path: string; depth: number; direct: number } | undefined
  for (const [collection, documents] of clusters) {
    const depth = collection === "" ? 0 : collection.split("/").length
    const better =
      !best ||
      documents.length > best.direct ||
      // A tie on size goes to the shallower directory, and a tie on that to the
      // alphabetically first, so the answer does not depend on iteration order.
      (documents.length === best.direct &&
        (depth < best.depth ||
          (depth === best.depth && collection < best.path)))
    if (better) best = { path: collection, depth, direct: documents.length }
  }
  if (!best) return null

  const documents = clusters.get(best.path) ?? []
  const only = documents[0]
  // A document whose skill directory *is* the repository root — `skills/SKILL.md`
  // — has no collection above it to name. The document is then the answer: the
  // directory that holds it would come back with nothing beneath it.
  if (best.path === "" && only !== undefined) {
    return { path: only, mode: "file", documents: 1 }
  }

  const prefix = `${best.path}/`
  return {
    path: best.path,
    mode: "directory",
    documents: paths.filter((path) => path.startsWith(prefix)).length,
  }
}

/**
 * Asks the repository where its skills are, for a path that turned out to point
 * at nothing.
 *
 * This is the second attempt, not the first: a project's configured path is
 * honoured whenever the repository has it, and only its absence sends the sync
 * here. What it costs is one request, against the several a list of
 * "conventional" layouts would cost to try in turn — and, unlike such a list, it
 * does not decide in advance which layouts exist.
 */
export async function discoverSkillRoot(
  client: GitHubClient,
  fullName: string,
  ref?: string
): Promise<SkillRoot | null> {
  let found
  try {
    found = await client.findSkillDocuments(fullName, ref)
  } catch (error) {
    // A repository or branch that is gone answers the question as "nothing
    // here"; a rate limit is not that, and swallowing it would turn a throttle
    // into a silent empty result.
    if (error instanceof GitHubNotFoundError) return null
    throw error
  }

  return skillRootFromPaths(found.paths)
}

/**
 * The path of a skill's SKILL.md inside a directory-mode repository.
 *
 * The base is the project's configured path, so a directory of skills works
 * wherever a repository keeps it rather than only at the repository root.
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
