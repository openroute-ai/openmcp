/**
 * The per-project refresh pipeline.
 *
 * The scheduled sweep and the operator's "resync this project" button need the
 * same work, so it lives here rather than inside the task body. The source app
 * kept this as a whole-repository task that the manual button reached by
 * building a task runner around a single-element list; here the sweep already
 * has the batched metadata fetch that such a runner could not give it, so the
 * shared unit is the per-repository step and the sweep hands its batched
 * result in rather than re-requesting it.
 *
 * Two layers, because they cost very different amounts:
 *
 * - {@link refreshRepoFromGitHub} talks to GitHub and OSS. It is what a sweep
 *   runs. Asset uploads are guarded on "not already mirrored", so running it
 *   for a repository that is already mirrored uploads nothing.
 * - {@link translateRepoContent} calls a language model. It is what a manual
 *   resync runs, and it declines to write anything when no model is configured,
 *   so a deployment without one never puts English into a `*_zh` column.
 */

import {
  linkAuthorToProjectFromRepo,
} from "@/lib/github/service/hall-of-fame"
import { getProjectById, syncProjectFromRepo } from "@/lib/github/service/project"
import {
  getRepoById,
  setContributorCount,
  setIconUrls,
  setReadme,
  setTranslations,
  upsertRepo,
  type Db,
  type RepoRow,
} from "@/lib/github/service/repo"
import { recordMonth } from "@/lib/github/service/snapshot"
import { syncSkillsForProject } from "@/lib/github/sync-skills"
import { getYearMonth } from "@/lib/github/snapshot-dates"
import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import { createChatModel } from "@/lib/ai/provider"
import { translator as defaultTranslator, type Translator } from "@/lib/ai/translator"
import { ossClient } from "@/lib/oss/client"
import type { projects } from "@/db/schema"
import type { LanguageModel } from "ai"
import type { TaskLogger } from "@/lib/tasks/runner"

type ProjectRow = typeof projects.$inferSelect

export interface RefreshRepoResult {
  /** False when the repository has no README, which is a real state. */
  readme: boolean
  contributorCount: boolean
  icon: boolean
  openGraphImage: boolean
  snapshot: boolean
}

export interface RefreshRepoOptions {
  logger: TaskLogger
  /**
   * Metadata already fetched for this repository.
   *
   * The sweep fetches in batches of 100 and passes the result here, which is
   * the whole reason the batching is worth keeping. A caller holding nothing
   * leaves it unset and the metadata is fetched for this repository alone.
   */
  info?: RepoInfo
}

export interface TranslateRepoResult {
  /** Which fields a model actually produced. All false means nothing was. */
  description: boolean
  readme: boolean
  releaseNote: boolean
}

export interface SyncProjectResult {
  refresh: RefreshRepoResult
  /** Null when no model is configured, so nothing was written. */
  translate: TranslateRepoResult | null
  skills: number
  authorLinked: boolean
  /** Steps that failed but did not stop the run. */
  warnings: string[]
}

export interface SyncProjectDeps {
  logger: TaskLogger
  client?: GitHubClient
  /** Injected so one model is shared across a loop instead of built per call. */
  chatModel?: LanguageModel | undefined
  /** Injected by tests; the module singleton otherwise. */
  translate?: Translator
}

/**
 * Refreshes one repository from GitHub and stores what came back.
 *
 * Every step is guarded on its own. GitHub rate-limits the contributor and
 * README endpoints harder than the metadata query, and a sweep that abandoned a
 * repository on the first failure would leave all of its other fields stale for
 * no reason.
 */
export async function refreshRepoFromGitHub(
  db: Db,
  client: GitHubClient,
  repo: RepoRow,
  options: RefreshRepoOptions
): Promise<RefreshRepoResult> {
  const { logger } = options
  const fullName = `${repo.owner}/${repo.name}`

  let info = options.info
  if (!info) {
    try {
      info = await client.fetchRepoInfo(fullName)
    } catch (error) {
      // A repository that is gone or private cannot be refreshed at all, and
      // every step below needs this metadata. Reported rather than thrown, so
      // a sweep records one failure and moves on.
      logger.error(`could not fetch metadata for ${fullName}`, error)
      return {
        readme: false,
        contributorCount: false,
        icon: false,
        openGraphImage: false,
        snapshot: false,
      }
    }
  }

  // Written rather than assumed: a batch may have renamed the repository or
  // moved it to another owner, and the steps below address it by full name.
  const row = await upsertRepo(db, info)
  const currentFullName = `${row.owner}/${row.name}`

  let contributorCount = false
  try {
    const count = await client.fetchContributorCount(currentFullName)
    await setContributorCount(db, row.id, count)
    contributorCount = true
  } catch (error) {
    // Deliberately not recorded as zero: a rate-limited call would then read as
    // the repository having lost every contributor it had.
    logger.warn(`could not count contributors for ${currentFullName}`, error)
  }

  // The stored default branch, not an assumed "main": fetching from the wrong
  // branch returns the wrong README, or none.
  let readme = false
  try {
    const markdown = await client.fetchRepoReadMeAsMarkdown(
      currentFullName,
      row.defaultBranch ?? undefined
    )
    if (markdown) {
      await setReadme(db, row.id, markdown)
      readme = true
    }
  } catch (error) {
    logger.warn(`could not read README for ${currentFullName}`, error)
  }

  const icon = await mirrorIcon(db, row, logger)
  const openGraphImage = await mirrorOpenGraphImage(db, row, logger)
  const snapshot = await recordCurrentMonth(db, row)

  return { readme, contributorCount, icon, openGraphImage, snapshot }
}

/**
 * Mirrors the owner's avatar into the bucket, once.
 *
 * Guarded on `iconUrl` already being set: the URL is derived from the owner's
 * numeric id and never changes, so re-uploading it on every sweep would
 * multiply storage and CDN origin traffic for an identical picture.
 */
async function mirrorIcon(
  db: Db,
  repo: RepoRow,
  logger: TaskLogger
): Promise<boolean> {
  if (repo.iconUrl || !ossClient.isEnabled()) return false

  try {
    const source = `https://avatars.githubusercontent.com/u/${repo.ownerId}?v=3&s=200`
    const path = ossClient.generateOSSPath("icon", repo.name, "icon.png")
    const url = await ossClient.uploadFromUrl(source, path)
    if (url) {
      await setIconUrls(db, repo.id, { iconUrl: url })
      return true
    }
  } catch (error) {
    // A missing icon is cosmetic: the project falls back to the owner's avatar
    // and then to initials, so the rest of the refresh still stands.
    logger.warn(
      `could not mirror the icon for ${repo.owner}/${repo.name}`,
      error
    )
  }
  return false
}

/** Mirrors the Open Graph image, which GitHub regenerates per repository. */
async function mirrorOpenGraphImage(
  db: Db,
  repo: RepoRow,
  logger: TaskLogger
): Promise<boolean> {
  if (repo.openGraphImageOssUrl || !repo.openGraphImageUrl) return false
  if (!ossClient.isEnabled()) return false

  try {
    const path = ossClient.generateOSSPath("og-image", repo.name, "og.png")
    const url = await ossClient.uploadFromUrl(repo.openGraphImageUrl, path)
    if (url) {
      await setIconUrls(db, repo.id, { openGraphImageOssUrl: url })
      return true
    }
  } catch (error) {
    logger.warn(
      `could not mirror the Open Graph image for ${repo.owner}/${repo.name}`,
      error
    )
  }
  return false
}

/**
 * Records this month's counters against the star history.
 *
 * The month is keyed rather than appended, so running this twice in a day
 * updates the current month instead of inventing a second one. Reconstructing
 * earlier months needs a stargazer walk, which is the `snapshot-stars` task's
 * job and far too expensive to run per click.
 */
async function recordCurrentMonth(
  db: Db,
  repo: RepoRow
): Promise<boolean> {
  if (repo.stars == null) return false

  try {
    await recordMonth(db, repo.id, getYearMonth(new Date()), {
      stars: repo.stars,
      totalContributors: repo.contributorCount ?? undefined,
      totalPullRequests: repo.pullRequestsCount ?? undefined,
      totalReleases: repo.releasesCount ?? undefined,
    })
    return true
  } catch (error) {
    console.warn(
      `[sync-project] could not record the snapshot for ${repo.id}`,
      error
    )
    return false
  }
}

/**
 * Fills the `*_zh` columns for one repository.
 *
 * Returns null when no model is configured, and the caller then writes
 * nothing. That guard is the reason this is a separate function: `Translator`
 * returns its input unchanged when the model call fails, so translating without
 * a provider would store the English README in `readme_content_zh` and the
 * interface would offer a "中文" tab containing English.
 */
export async function translateRepoContent(
  db: Db,
  repo: RepoRow,
  options: {
    logger: TaskLogger
    chatModel?: LanguageModel | undefined
    translate?: Translator
  }
): Promise<TranslateRepoResult | null> {
  const chatModel =
    options.chatModel === undefined ? createChatModel() : options.chatModel
  if (!chatModel) {
    options.logger.warn(
      `no AI provider configured, leaving ${repo.owner}/${repo.name} untranslated`
    )
    return null
  }

  const translate = options.translate ?? defaultTranslator
  const logger = options.logger
  const result: TranslateRepoResult = {
    description: false,
    readme: false,
    releaseNote: false,
  }
  const pending: {
    descriptionZh?: string
    readmeContentZh?: string
    latestReleaseDescriptionZh?: string
  } = {}

  // One guarded step per field, run in parallel: a long README and a short
  // description do not depend on each other, and a failure in one must not cost
  // the other two.
  const guard = async (
    label: string,
    source: string | null,
    field: keyof typeof pending,
    flag: keyof TranslateRepoResult,
    translateOne: (value: string) => Promise<string>
  ): Promise<void> => {
    if (!source) return
    try {
      const value = await translateOne(source)
      pending[field] = value
      result[flag] = true
    } catch (error) {
      logger.warn(`could not translate the ${label} for ${repo.owner}/${repo.name}`, error)
    }
  }

  await Promise.all([
    guard(
      "description",
      repo.description,
      "descriptionZh",
      "description",
      (value) => translate.translateDescription(value)
    ),
    guard("README", repo.readmeContent, "readmeContentZh", "readme", (value) =>
      translate.translateReadme(value)
    ),
    guard(
      "release note",
      repo.latestReleaseDescription,
      "latestReleaseDescriptionZh",
      "releaseNote",
      (value) => translate.translateReleaseNote(value)
    ),
  ])

  if (Object.keys(pending).length > 0) {
    await setTranslations(db, repo.id, pending)
  }

  return result
}

/**
 * Runs the whole refresh for one project and reports what each part did.
 *
 * Throws only when the project itself cannot be addressed. Every other failure
 * is recorded as a warning: the caller writes the outcome to a sync job, and a
 * job saying "the README could not be fetched" tells an operator far more than
 * an exception saying only that something went wrong, because the parts that
 * did succeed are still stored.
 */
export async function syncProjectData(
  db: Db,
  projectId: string,
  deps: SyncProjectDeps
): Promise<SyncProjectResult> {
  const { logger } = deps
  const warnings: string[] = []
  const client = deps.client ?? createGitHubClient()

  const project = await getProjectById(db, projectId)
  if (!project) {
    throw new Error(`no project with id ${projectId}`)
  }
  if (!project.repo) {
    throw new Error(`project ${projectId} has no repository ${project.repoId}`)
  }

  const refresh = await refreshRepoFromGitHub(db, client, project.repo, {
    logger,
  })

  // Re-read rather than reusing the row loaded above: the refresh may have
  // renamed the repository or moved it to another owner, and translation reads
  // the README, the assets and the counters the refresh just wrote.
  const repo = (await getRepoById(db, project.repoId)) ?? project.repo

  const translate = await translateRepoContent(db, repo, {
    logger,
    chatModel: deps.chatModel,
    translate: deps.translate,
  })

  await syncProjectFromRepo(db, projectId)
  const authorLinked = await linkAuthorToProjectFromRepo(db, repo, projectId)

  let skills = 0
  if (project.type === "skill") {
    try {
      const result = await syncSkillsForProject(
        db,
        client,
        { project: project as ProjectRow, repo },
        { logger, chatModel: deps.chatModel }
      )
      skills = result.skills
    } catch (error) {
      warnings.push(message(error))
      logger.error(`skill sync failed for ${project.slug}`, error)
    }
  }

  if (!refresh.readme) {
    warnings.push("the repository has no stored README")
  }

  return { refresh, translate, skills, authorLinked, warnings }
}


function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
