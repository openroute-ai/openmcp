/**
 * The per-project skill sync, extracted from the task that runs it.
 *
 * The task loops over every skill project, and a single project is also synced
 * on its own when one is created. Both need the same fetch, translate and store
 * pipeline, so it lives here rather than inside the task body, where it could
 * only be reached by syncing everything.
 *
 * A project whose fetch fails keeps its stored skills: deleting them on a
 * transient failure would unpublish a working project, which is also why
 * `syncProjectSkills` refuses to delete on an empty discovery.
 *
 * A path the repository does not have is an empty discovery rather than a
 * failure, on the same grounds: nothing about the next run will change it, and
 * recording it as failed puts a permanent state in the same column as a rate
 * limit, so neither the operator nor the retry queue can tell them apart.
 *
 * That leaves one question worth answering rather than reporting: when the
 * **default** path is the one that is missing, the repository is asked where its
 * skills are instead. Most repositories do not keep a `SKILL.md` at the root —
 * `SKILL.md` is the schema default, not a description of anyone's layout — so
 * answering "nothing there" to the common case would fail every submission whose
 * author did not happen to name the path. A path somebody set is left alone;only
 * the default is second-guessed.
 */

import {
  discoverSkillRoot,
  parseSkillMd,
  readSkillSource,
  skillPathInDir,
  type SkillSource,
} from "@/lib/github/skill"
import {
  listSkillsForProject,
  syncProjectSkills,
} from "@/lib/github/service/skill"
import { updateProject } from "@/lib/github/service/project"
import { GitHubRateLimitError } from "@/lib/github/errors"
import type { Db } from "@/lib/github/service/repo"
import type { GitHubClient } from "@/lib/github/client"
import type { projects, repos } from "@/db/schema"
import { createChatModel } from "@/lib/ai/provider"
import { translateSkills } from "@/lib/ai/translate-skills"
import { translator } from "@/lib/ai/translator"
import { mapWithConcurrency } from "@/lib/concurrency"
import type { LanguageModel } from "ai"
import type { TaskLogger } from "@/lib/tasks/runner"

/**
 * How many skill directories are read at once.
 *
 * Reading one at a time made a repository with a dozen skills spend a dozen
 * serial round trips before the first translation started. Eight is well inside
 * GitHub's secondary rate limit for these unauthenticated-per-call reads, and a
 * limit this low still keeps the request count for a small repository at exactly
 * what it was.
 */
const DIRECTORY_READ_CONCURRENCY = 8

export interface SkillSyncTarget {
  project: typeof projects.$inferSelect
  repo: typeof repos.$inferSelect
}

export interface SkillSyncResult {
  /** Skills stored, or 0 when the repository holds none. */
  skills: number
  /** How many of them came back with a translation. */
  translated: number
  /** True when the repository yielded nothing and stored rows were kept. */
  empty: boolean
}

export interface SyncSkillsOptions {
  logger: TaskLogger
  /** Injected so one model is shared by a loop instead of built per project. */
  chatModel?: LanguageModel | undefined
}

/**
 * Fetches, translates and stores one project's skills.
 *
 * Translation is folded back in only when a model is configured: without one
 * the parse-and-store half stands alone, and the push task delivers the
 * documents with empty `zh` fields, which is honest rather than fabricated.
 */
export async function syncSkillsForProject(
  db: Db,
  client: GitHubClient,
  target: SkillSyncTarget,
  options: SyncSkillsOptions
): Promise<SkillSyncResult> {
  const { project, repo } = target
  const logger = options.logger
  const chatModel =
    options.chatModel === undefined ? createChatModel() : options.chatModel

  const fullName = `${repo.owner}/${repo.name}`
  const ref = repo.defaultBranch ?? undefined
  const configured = project.skillMdPath ?? DEFAULT_SKILL_PATH

  // Whether the path holds one document or a directory of them is read from the
  // repository, so a project whose skills live anywhere — `SKILL.md`,
  // `skills/`, `.agents/skills/` — is discovered rather than assumed.
  const { path, source } = await locateSkills(client, fullName, configured, ref)

  const skills =
    source === null
      ? []
      : source.mode === "file"
        ? fileModeSkills(path, source.raw)
        : await readDirectorySkills(client, fullName, path, source.dirs, ref)

  if (path !== configured) {
    // Recorded, not just applied. The next run — and the retry queue behind this
    // one — reads `skill_md_path` first, so leaving the default in place would
    // pay for the same dead lookup on every sweep, and the operator looking at
    // the project would still see the path that does not exist.
    logger.warn(
      `${fullName}: ${configured} is not in this repository, using ${path}`
    )
    await updateProject(db, project.id, { skillMdPath: path })
  }

  if (skills.length === 0) {
    // The path is named because "no skills" and "the path points at nothing"
    // need different corrections, and only this line survives to say which one
    // happened.
    logger.warn(`no skills at ${fullName}/${path}, keeping stored skills`)
    return { skills: 0, translated: 0, empty: true }
  }

  const stored = new Map(
    (await listSkillsForProject(db, project.id)).map((skill) => [
      skill.skillDir,
      skill,
    ])
  )

  const translations = await translateSkills(
    skills,
    stored,
    async (description, readme) => {
      if (!chatModel) return { descriptionZh: "", readmeZh: "" }
      const [descriptionZh, readmeZh] = await Promise.all([
        translator.translateDescription(description),
        translator.translateReadme(readme),
      ])
      return { descriptionZh, readmeZh }
    }
  )

  await syncProjectSkills(
    db,
    project.id,
    skills.map((skill, index) => ({
      projectId: project.id,
      ...skill,
      ...translations[index],
    }))
  )

  return {
    skills: skills.length,
    translated: translations.filter(
      (item) => item.descriptionZh || item.readmeZh
    ).length,
    empty: false,
  }
}

/** What a single parsed document contributes, before its project is attached. */
type ParsedSkill = ReturnType<typeof parseSkillMd>

interface DiscoveredSkill extends ParsedSkill {
  skillDir: string
}

/**
 * The path a project is given when nobody names one, matching the column's own
 * default in `schema/github.ts`.
 *
 * Spelled out rather than inlined at each use because it appears in two places
 * that must not drift: the lookup below and the value written back when
 * discovery replaces it.
 */
const DEFAULT_SKILL_PATH = "SKILL.md"

/**
 * Finds the path to read, falling back to what the repository says it has.
 *
 * The configured path is tried first and is the answer whenever it exists, so an
 * operator who has corrected a path is never overridden by a discovery. Only its
 * absence — `readSkillSource`'s `null`, a permanent answer — asks the
 * repository, and the answer replaces the dead path rather than being applied for
 * this run alone.
 */
async function locateSkills(
  client: GitHubClient,
  fullName: string,
  configured: string,
  ref?: string
): Promise<{ path: string; source: SkillSource | null }> {
  const source = await readSkillSource(client, fullName, configured, ref)
  if (source !== null) return { path: configured, source }

  // Only the untouched default is second-guessed. A path somebody typed is an
  // instruction, and silently replacing it with a guess would hide their typo
  // behind a working import — the one mistake they would want to see reported.
  if (configured !== DEFAULT_SKILL_PATH) {
    return { path: configured, source }
  }

  const root = await discoverSkillRoot(client, fullName, ref)
  if (!root || root.path === configured) return { path: configured, source }

  return {
    path: root.path,
    source: await readSkillSource(client, fullName, root.path, ref),
  }
}

/**
 * File mode: the configured path is one document.
 *
 * The directory key is the path itself, so a project that later points at a
 * directory stores under different keys rather than colliding with the rows a
 * file-mode project wrote.
 */
function fileModeSkills(path: string, raw: string): DiscoveredSkill[] {
  if (!raw) return []
  return [{ skillDir: path, ...parseSkillMd(raw) }]
}

/**
 * Directory mode: each subdirectory under the path may hold a skill.
 *
 * One unreadable subdirectory does not fail the repository: a directory that
 * turns out not to contain a SKILL.md is skipped, and the rest are kept. A rate
 * limit is the exception, because it is not that directory's fault and carrying
 * on would spend the rest of the budget on requests already being refused.
 *
 * The subdirectories are read a few at a time. A repository with a dozen skills
 * otherwise costs a dozen serial round trips before the first word is
 * translated, and that read time is charged to whoever is waiting on the answer.
 */
async function readDirectorySkills(
  client: GitHubClient,
  fullName: string,
  path: string,
  dirs: string[],
  ref?: string
): Promise<DiscoveredSkill[]> {
  const readOne = async (dir: string): Promise<DiscoveredSkill | undefined> => {
    try {
      const source = await readSkillSource(
        client,
        fullName,
        skillPathInDir(path, dir),
        ref
      )
      if (source?.mode === "file" && source.raw) {
        return { skillDir: dir, ...parseSkillMd(source.raw) }
      }
      return undefined
    } catch (error) {
      if (error instanceof GitHubRateLimitError) throw error
      return undefined
    }
  }

  const read = await mapWithConcurrency(
    dirs,
    DIRECTORY_READ_CONCURRENCY,
    readOne
  )
  return read.filter((skill): skill is DiscoveredSkill => skill !== undefined)
}
