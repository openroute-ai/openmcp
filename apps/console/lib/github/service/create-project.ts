/**
 * Creating a project from a GitHub URL.
 *
 * This is the curation step: discovery stores candidate repositories with no
 * project attached, and a project row is what publishes one. So the flow is
 * "an operator named a repository, make it a project and bring it up to date"
 * — resolve the repository, create the project, link the author, then sync
 * what that project needs now rather than leaving it to the next cycle.
 *
 * Each follow-up step is recorded as a sync job, because a create that fetched
 * the README and one that could not must not look the same afterwards.
 */

import {
  linkAuthorToProject,
  upsertAuthorFromRepo,
} from "@/lib/github/service/hall-of-fame"
import {
  NO_DESCRIPTION,
  createProject,
  generateUniqueSlug,
  getProjectByFullName,
} from "@/lib/github/service/project"
import {
  getRepoByFullName,
  setReadme,
  upsertRepo,
  type Db,
  type RepoRow,
} from "@/lib/github/service/repo"
import {
  finishProjectSyncJob,
  finishReadmeSyncJob,
  startProjectSyncJob,
  startReadmeSyncJob,
  type SyncOutcome,
} from "@/lib/github/service/sync-job"
import { syncSkillsForProject } from "@/lib/github/sync-skills"
import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import { parseGithubRepoUrl } from "@/lib/github/repo-url"
import type { ProjectType, projects } from "@/db/schema"
import type { TaskLogger } from "@/lib/tasks/runner"

export interface CreateProjectFromRepoInput {
  url: string
  type?: ProjectType
}

export interface CreateProjectFromRepoResult {
  project: {
    id: string
    name: string
    slug: string
    type: ProjectType
    status: string
    description: string
  }
  /** `existing` when the repository already had a project, so nothing changed. */
  status: "created" | "existing"
  readme: { synced: boolean; error?: string }
  skills: { count: number; translated: number; empty: boolean } | null
  authorLinked: boolean
}

export interface CreateProjectDeps {
  /** Injected by tests and by callers that already hold a client. */
  client?: GitHubClient
  logger: TaskLogger
}

/** Thrown for input the operator can correct, as opposed to a failed fetch. */
export class InvalidRepoUrlError extends Error {}

/**
 * Creates a project for a GitHub URL, or reports the one already there.
 *
 * Idempotent by repository: a URL that is already curated returns the existing
 * project instead of a second one, so a double submit or a retried request
 * cannot publish the same repository twice.
 *
 * A failed follow-up is recorded, not raised. A project whose README could
 * not be fetched is still a published project, and refusing to create it
 * because a secondary fetch failed would discard the curation the operator
 * actually asked for.
 */
export async function createProjectFromRepo(
  db: Db,
  input: CreateProjectFromRepoInput,
  deps: CreateProjectDeps
): Promise<CreateProjectFromRepoResult> {
  const parsed = parseGithubRepoUrl(input.url)
  if (!parsed) {
    throw new InvalidRepoUrlError(
      `"${input.url}" is not a GitHub repository URL`
    )
  }

  const existing = await getProjectByFullName(db, parsed.fullName)
  if (existing) {
    return {
      project: {
        id: existing.id,
        name: existing.name,
        slug: existing.slug,
        type: existing.type,
        status: existing.status,
        description: existing.description,
      },
      status: "existing",
      readme: { synced: false },
      skills: null,
      authorLinked: false,
    }
  }

  // A repository the discovery or refresh tasks already stored is reused: a
  // second fetch would spend a GraphQL request to write the same numbers back.
  const client = deps.client ?? createGitHubClient()
  const repo =
    (await getRepoByFullName(db, parsed.fullName)) ??
    (await upsertRepo(db, await client.fetchRepoInfo(parsed.fullName)))

  const type = input.type ?? "application"
  const project = await createProject(db, {
    repoId: repo.id,
    name: parsed.name,
    owner: repo.owner,
    slug: await generateUniqueSlug(db, parsed.name),
    // The repository description is the only prose available here, and an
    // empty cell reads as a project nobody ever described.
    description: repo.description || NO_DESCRIPTION,
    url: repo.homepage || `https://github.com/${parsed.fullName}`,
    type,
  })

  deps.logger.info(
    `created ${type} project ${parsed.fullName} (${project.slug})`
  )

  const authorLinked = await linkAuthor(db, repo, project.id)

  const readme = await syncReadme(db, client, repo)

  const skills =
    type === "skill"
      ? await syncSkills(db, client, project, repo, deps.logger)
      : null

  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      type: project.type,
      status: project.status,
      description: project.description,
    },
    status: "created",
    readme,
    skills,
    authorLinked,
  }
}

/**
 * Fetches the README and records the attempt as a readme sync job.
 *
 * The stored default branch is used rather than an assumed "main", because
 * fetching from the wrong branch returns the wrong README or none at all.
 */
async function syncReadme(
  db: Db,
  client: GitHubClient,
  repo: RepoRow
): Promise<{ synced: boolean; error?: string }> {
  const jobId = await startReadmeSyncJob(db, {
    repoId: repo.id,
    triggeredBy: "project_create",
  })

  try {
    const readme = await client.fetchRepoReadMeAsMarkdown(
      `${repo.owner}/${repo.name}`,
      repo.defaultBranch ?? undefined
    )

    if (!readme) {
      // A repository with no README is a real state, not a failure: the job
      // succeeded and stored nothing.
      await finishReadmeSyncJob(db, jobId, { ok: true })
      return { synced: false }
    }

    await setReadme(db, repo.id, readme)
    await finishReadmeSyncJob(db, jobId, { ok: true })
    return { synced: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishReadmeSyncJob(db, jobId, { ok: false, error: message })
    return { synced: false, error: message }
  }
}

/**
 * Syncs a new skill project's documents and records the project sync job.
 *
 * Recorded as one job covering the project's follow-up work, so a create whose
 * skills could not be fetched is distinguishable from one that stored none.
 */
async function syncSkills(
  db: Db,
  client: GitHubClient,
  project: typeof projects.$inferSelect,
  repo: RepoRow,
  logger: TaskLogger
): Promise<{ count: number; translated: number; empty: boolean }> {
  const jobId = await startProjectSyncJob(db, {
    projectId: project.id,
    repoId: repo.id,
    triggeredBy: "project_create",
  })

  let outcome: SyncOutcome
  let result: { count: number; translated: number; empty: boolean }

  try {
    const { skills, translated, empty } = await syncSkillsForProject(
      db,
      client,
      { project, repo },
      { logger }
    )
    result = { count: skills, translated, empty }
    outcome = { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result = { count: 0, translated: 0, empty: false }
    outcome = { ok: false, error: message }
    logger.error(`skill sync failed for ${repo.owner}/${repo.name}`, error)
  }

  await finishProjectSyncJob(db, jobId, outcome)
  return result
}

/**
 * Records the author's presence in the hall of fame and links the project.
 *
 * Best effort: an author entry is a byline, and a create that failed on one
 * would leave the project unpublished for a cosmetic reason.
 */
async function linkAuthor(
  db: Db,
  repo: RepoRow,
  projectId: string
): Promise<boolean> {
  try {
    await upsertAuthorFromRepo(db, {
      owner: repo.owner,
      // The column is an integer; the avatar URL builder takes a string.
      ownerId: String(repo.ownerId),
      homepage: repo.homepage,
    })
    await linkAuthorToProject(db, repo.owner, projectId)
    return true
  } catch (error) {
    console.warn("[create-project] could not record the author", error)
    return false
  }
}
