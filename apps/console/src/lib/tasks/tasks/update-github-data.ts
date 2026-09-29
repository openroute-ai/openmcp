/**
 * Refreshes repository metadata from GitHub.
 *
 * The shape of the run follows the source app's `update-github-data`, with two
 * differences that matter:
 *
 * - Metadata is fetched in batches of 100 through the batched GraphQL query
 *   rather than one request per repository. The source issued one GraphQL call
 *   per repository, so a 500-repository refresh spent 500 requests before
 *   contributor counts and READMEs were counted, and the hourly budget was
 *   gone before the run finished.
 * - Contributor counts come from REST instead of an HTML scrape of the
 *   repository page, which the source did with a CSS selector and which broke
 *   silently whenever GitHub changed its markup.
 */

import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import {
  setAuthorProjects,
  upsertAuthorFromRepo,
} from "@/lib/github/service/hall-of-fame"
import { listAllProjects, syncProjectFromRepo } from "@/lib/github/service/project"
import {
  listAllRepos,
  listReposByOwner,
  setContributorCount,
  setReadme,
  upsertRepo,
  type Db,
} from "@/lib/github/service/repo"
import { processItems } from "@/lib/tasks/iterate"
import type { Task, TaskLogger } from "@/lib/tasks/runner"

/** A minimum gap between REST calls, to stay inside the secondary rate limit. */
const REST_THROTTLE_MS = 100

export function createUpdateGitHubDataTask(
  client: GitHubClient = createGitHubClient()
): Task {
  return {
    name: "update-github-data",
    description:
      "Refresh repository metadata, contributor counts and READMEs, then sync " +
      "curated projects and hall-of-fame authors from the refreshed data",

    async run({ db, logger }) {
      const stored = await listAllRepos(db)
      logger.info(`refreshing ${stored.length} repos`)

      if (stored.length === 0) return { processed: 0, updated: 0, missing: 0 }

      const { results, missing } = await client.fetchRepos(
        stored.map((repo) => `${repo.owner}/${repo.name}`)
      )

      if (missing.length > 0) {
        // Not fatal: a repository can be deleted, renamed or made private, and
        // the rest of the sweep is still valid. Counted so it is visible.
        logger.warn(`${missing.length} repos could not be fetched`, missing)
      }

      let updated = 0
      for (const info of results.values()) {
        try {
          await upsertRepo(db, info)
          updated += 1
        } catch (error) {
          logger.error(`could not store ${info.fullName}`, error)
        }
      }

      // Re-read: the batch may have renamed a repository or moved it to another
      // owner, and the per-repository REST work below writes against the rows.
      const rows = await listAllRepos(db)

      const perRepo = await processItems(
        rows,
        async (repo) => {
          const fullName = `${repo.owner}/${repo.name}`
          let counted = false

          try {
            const contributorCount = await client.fetchContributorCount(fullName)
            await setContributorCount(db, repo.id, contributorCount)
            counted = true
          } catch (error) {
            // Deliberately not recorded as zero: a rate-limited call would then
            // read as the project having lost every contributor it had.
            logger.warn(`could not count contributors for ${fullName}`, error)
          }

          // The stored default branch, not an assumed "main": fetching from the
          // wrong branch returns the wrong README, or none.
          const readme = await client.fetchRepoReadMeAsMarkdown(
            fullName,
            repo.defaultBranch ?? undefined
          )
          if (readme) await setReadme(db, repo.id, readme)

          return {
            meta: {
              processed: 1,
              readme: readme ? 1 : 0,
              contributorCount: counted ? 1 : 0,
            },
            data: null,
          }
        },
        {
          logger,
          label: "repo",
          concurrency: 5,
          throttleIntervalMs: REST_THROTTLE_MS,
        }
      )

      const { projects: projectsSynced, authors } = await syncProjectsAndAuthors(
        db,
        logger
      )

      return {
        processed: perRepo.meta.processed ?? 0,
        updated,
        missing: missing.length,
        readme: perRepo.meta.readme ?? 0,
        contributorCount: perRepo.meta.contributorCount ?? 0,
        errors: perRepo.meta.error ?? 0,
        projectsSynced,
        authors,
      }
    },
  }
}

/**
 * Pushes refreshed repository data into projects and authors.
 *
 * Projects inherit description and homepage from their repository unless a
 * human has overridden them, which is where that editorial decision is
 * respected. Authors are derived from the repository owner, and each author's
 * project set is replaced rather than appended to, so withdrawing a project
 * from a repository also withdraws it from the author's page.
 */
async function syncProjectsAndAuthors(
  db: Db,
  logger: TaskLogger
): Promise<{ projects: number; authors: number }> {
  const allProjects = await listAllProjects(db, { includeHidden: true })
  const owners = await listReposByOwner(db)

  const projectsSynced = await processItems(
    allProjects,
    async (project) => {
      await syncProjectFromRepo(db, project.id)
      return { meta: { synced: 1 }, data: null }
    },
    { logger, label: "project" }
  )

  const authorsSynced = await processItems(
    owners,
    async (entry) => {
      await upsertAuthorFromRepo(db, {
        owner: entry.owner,
        ownerId: String(entry.ownerId),
        homepage: entry.homepage,
      })
      // Replaced rather than appended, so a project withdrawn from a
      // repository disappears from the author's page too.
      await setAuthorProjects(
        db,
        entry.owner,
        entry.repos.flatMap((repo) => repo.projectIds)
      )
      return { meta: { synced: 1 }, data: null }
    },
    { logger, label: "author" }
  )

  return {
    projects: projectsSynced.meta.synced ?? 0,
    authors: authorsSynced.meta.synced ?? 0,
  }
}
