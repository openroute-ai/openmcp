/**
 * The per-project skill sync, extracted from the task that runs it.
 *
 * The task loops over every skill project; a single project is also synced on
 * its own when one is created, and when an operator asks for one from the
 * dashboard. Both need the same fetch, translate and store pipeline, so it
 * lives here rather than inside the task body, where it could only be reached
 * by syncing everything.
 *
 * A project whose fetch fails keeps its stored skills: deleting them on a
 * transient failure would unpublish a working project, which is also why
 * `syncProjectSkills` refuses to delete on an empty discovery.
 */

import {
  fetchSkillMd,
  isSkillDirMode,
  listSkillDirs,
  parseSkillMd,
  skillPathInDir,
} from "@/lib/github/skill"
import {
  listSkillsForProject,
  syncProjectSkills,
} from "@/lib/github/service/skill"
import type { Db } from "@/lib/github/service/repo"
import type { GitHubClient } from "@/lib/github/client"
import type { projects, repos } from "@/db/schema"
import { createChatModel } from "@/lib/ai/provider"
import { translateSkills } from "@/lib/ai/translate-skills"
import { translator } from "@/lib/ai/translator"
import type { LanguageModel } from "ai"
import type { TaskLogger } from "@/lib/tasks/runner"

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
  const path = project.skillMdPath ?? "SKILL.md"

  const skills = isSkillDirMode(path)
    ? await readDirectorySkills(client, fullName, path, ref)
    : await readSingleSkill(client, fullName, path, ref)

  if (skills.length === 0) {
    logger.warn(`no skills found in ${fullName}, keeping stored skills`)
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
 * File mode: the project points at one document.
 *
 * The directory key is the path itself, so a project that switches between
 * file and directory mode stores under a different key rather than colliding
 * with a directory-mode row.
 */
async function readSingleSkill(
  client: GitHubClient,
  fullName: string,
  path: string,
  ref?: string
): Promise<DiscoveredSkill[]> {
  const raw = await fetchSkillMd(client, fullName, path, ref)
  if (!raw) return []
  return [{ skillDir: path, ...parseSkillMd(raw) }]
}

/**
 * Directory mode: every subdirectory under `skills/` may hold a skill.
 *
 * One unreadable subdirectory does not fail the repository: a directory that
 * turns out not to contain a SKILL.md is skipped, and the rest are kept.
 */
async function readDirectorySkills(
  client: GitHubClient,
  fullName: string,
  path: string,
  ref?: string
): Promise<DiscoveredSkill[]> {
  const dirs = await listSkillDirs(client, fullName, path, ref)
  const found: DiscoveredSkill[] = []

  for (const dir of dirs) {
    try {
      const raw = await fetchSkillMd(
        client,
        fullName,
        skillPathInDir(path, dir),
        ref
      )
      if (raw) found.push({ skillDir: dir, ...parseSkillMd(raw) })
    } catch {
      // A directory without a readable SKILL.md is not a reason to abandon
      // the sibling directories that do have one.
    }
  }

  return found
}
