/**
 * Fetches and stores every skill project's SKILL.md documents.
 *
 * The source app parsed the skills, translated them, and posted them to
 * another service. Only the parse-and-store half is migrated here, because the
 * translation and the downstream push are separate concerns with their own
 * credentials: the push is a separate task reading
 * {@link listSkillsNeedingPush}, so a run here cannot depend on a downstream
 * service being reachable.
 *
 * A project whose fetch fails keeps its stored skills. Deleting them on a
 * transient failure would unpublish a working project, which is why
 * `syncProjectSkills` also refuses to delete on an empty discovery.
 */

import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import {
  fetchSkillMd,
  isSkillDirMode,
  listSkillDirs,
  parseSkillMd,
  skillPathInDir,
} from "@/lib/github/skill"
import { listSkillProjects, syncProjectSkills } from "@/lib/github/service/skill"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"

const SKILL_THROTTLE_MS = 200

/** What a single parsed document contributes, before its project is attached. */
type ParsedSkill = ReturnType<typeof parseSkillMd>

interface DiscoveredSkill extends ParsedSkill {
  skillDir: string
}

export function createSyncSkillReposTask(
  client: GitHubClient = createGitHubClient()
): Task {
  return {
    name: "sync-skill-repos",
    description:
      "Fetch SKILL.md from every skill project, in file or directory mode, and " +
      "replace the stored skills with what was found",

    async run({ db, logger }) {
      const projects = await listSkillProjects(db)
      logger.info(`syncing ${projects.length} skill project(s)`)

      const result = await processItems(
        projects,
        async ({ project, repo }) => {
          const fullName = `${repo.owner}/${repo.name}`
          const ref = repo.defaultBranch ?? undefined
          const path = project.skillMdPath ?? "SKILL.md"

          const skills = isSkillDirMode(path)
            ? await readDirectorySkills(client, fullName, path, ref)
            : await readSingleSkill(client, fullName, path, ref)

          if (skills.length === 0) {
            // A repository that lost its skills is a real state, and so is a
            // listing that failed. Passing the empty set through is what keeps
            // the two apart: syncProjectSkills removes nothing on an empty
            // discovery, and the next run resolves it.
            logger.warn(`no skills found in ${fullName}, keeping stored skills`)
            return { meta: { empty: 1 }, data: null }
          }

          await syncProjectSkills(
            db,
            project.id,
            skills.map((skill) => ({ projectId: project.id, ...skill }))
          )

          return { meta: { synced: 1, skills: skills.length }, data: null }
        },
        {
          logger,
          label: "skill project",
          concurrency: 3,
          throttleIntervalMs: SKILL_THROTTLE_MS,
        }
      )

      return {
        projects: projects.length,
        synced: result.meta.synced ?? 0,
        skills: result.meta.skills ?? 0,
        empty: result.meta.empty ?? 0,
        errors: result.meta.error ?? 0,
      }
    },
  }
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
