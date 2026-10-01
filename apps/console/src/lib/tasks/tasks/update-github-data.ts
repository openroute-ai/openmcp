/**
 * Refreshes repository metadata from GitHub.
 *
 * The shape of the run follows the source app's `update-github-data`, with the
 * per-repository work delegated to `refreshRepoFromGitHub` so that the manual
 * "resync this project" button and this sweep cannot drift apart, and with three
 * differences that matter:
 *
 * - Metadata is fetched in batches of 100 through the batched GraphQL query
 *   rather than one request per repository. The source issued one GraphQL call
 *   per repository, so a 500-repository refresh spent 500 requests before
 *   contributor counts and READMEs were counted, and the hourly budget was
 *   gone before the run finished. The batched result is handed to the shared
 *   refresh so it is not requested twice.
 * - Contributor counts come from REST instead of an HTML scrape of the
 *   repository page, which the source did with a CSS selector and which broke
 *   silently whenever GitHub changed its markup.
 * - Only repositories an administrator has curated are deep-refreshed. The
 *   expensive per-repository work — contributor counts, READMEs, mirrored
 *   assets — is the majority of this sweep's GitHub calls and only a project
 *   benefits from it. See {@link createUpdateGitHubDataTask}'s run for what
 *   that means in practice.
 * - Every repository is *sampled*, curated or not. The daily stats row is the
 *   site's record of how each repository moved, and a repository nobody has
 *   curated still earns stars; sampling only the curated set would leave the
 *   registry's numbers frozen while the rest of the site moves.
 *
 * Translation is deliberately not part of this sweep. The source re-translated
 * every README on every run, which is a language-model call per repository per
 * run; here it happens when an operator asks for it, in `syncProjectData`.
 */

import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import {
  setAuthorProjects,
  upsertAuthorFromRepo,
} from "@/lib/github/service/hall-of-fame"
import {
  listAllProjects,
  syncProjectFromRepo,
} from "@/lib/github/service/project"
import {
  listAllRepos,
  listCuratedRepos,
  listReposByOwner,
  upsertRepo,
  type Db,
} from "@/lib/github/service/repo"
import { recordCurrentPeriods } from "@/lib/github/service/stats"
import { refreshRepoFromGitHub } from "@/lib/github/sync-project"
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
      "Refresh repository metadata for every stored repository, then " +
      "deep-refresh, sync projects and rebuild hall-of-fame authors for the " +
      "ones an administrator has curated",

    async run({ db, logger }) {
      const stored = await listAllRepos(db)
      logger.info(`refreshing metadata for ${stored.length} repos`)

      if (stored.length === 0) return { processed: 0, updated: 0, missing: 0 }

      // Which repositories publish something, and therefore have derived state
      // to keep current. Read before the fetch so a project curated mid-run is
      // not silently skipped: the next run picks it up, but logging the count
      // here is what makes that visible.
      const curated = await listCuratedRepos(db)
      const curatedIds = new Set(curated.map((repo) => repo.id))
      logger.info(
        `${curatedIds.size} of ${stored.length} repos are curated and will be ` +
          `deep-refreshed`
      )

      const { results, missing } = await client.fetchRepos(
        stored.map((repo) => `${repo.owner}/${repo.name}`)
      )

      if (missing.length > 0) {
        // Not fatal: a repository can be deleted, renamed or made private, and
        // the rest of the sweep is still valid. Counted so it is visible.
        logger.warn(`${missing.length} repos could not be fetched`, missing)
      }

      // Re-read: the batch may have renamed a repository or moved it to another
      // owner, and the per-repository REST work below writes against the rows.
      const rows = await listAllRepos(db)
      const updated = rows.filter(
        (repo) => !missing.includes(`${repo.owner}/${repo.name}`)
      ).length

      const perRepo = await processItems(
        rows,
        async (repo) => {
          const info = results.get(`${repo.owner}/${repo.name}`)
          const fullName = `${repo.owner}/${repo.name}`

          // A repository nobody has curated is still refreshed, but only from
          // the batched metadata: it keeps its stars, description and push date
          // current, so the list a user reads is not stale. Everything past
          // that — contributor counts, the README, mirrored assets, the star
          // snapshot — is per-repository work that only a project benefits from,
          // and it is the majority of this sweep's GitHub calls.
          if (!curatedIds.has(repo.id)) {
            if (info) {
              // The returned row, not the pre-refresh one: the sweep may have
              // renamed the repository, and the stats are keyed by id.
              const row = await upsertRepo(db, info)
              await recordCurrentPeriods(db, row)
              return { meta: { processed: 1, metadataOnly: 1 }, data: null }
            }

            // No batched metadata to fall back on, so this repository is one of
            // the `missing` ones. Its stored row is left as it was: writing
            // zeroes would read as the repository having been emptied.
            logger.warn(`skipped metadata refresh for ${fullName}`)
            return { meta: { processed: 1 }, data: null }
          }

          const refreshed = await refreshRepoFromGitHub(db, client, repo, {
            logger,
            info,
          })

          return {
            meta: {
              processed: 1,
              readme: refreshed.readme ? 1 : 0,
              contributorCount: refreshed.contributorCount ? 1 : 0,
              icon: refreshed.icon ? 1 : 0,
              openGraphImage: refreshed.openGraphImage ? 1 : 0,
              snapshot: refreshed.snapshot ? 1 : 0,
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

      const { projects: projectsSynced, authors } =
        await syncProjectsAndAuthors(db, logger)

      return {
        processed: perRepo.meta.processed ?? 0,
        updated,
        missing: missing.length,
        // The split, because the two counts together explain what this run
        // actually spent its GitHub budget on.
        metadataOnly: perRepo.meta.metadataOnly ?? 0,
        deepRefreshed:
          (perRepo.meta.processed ?? 0) - (perRepo.meta.metadataOnly ?? 0),
        readme: perRepo.meta.readme ?? 0,
        contributorCount: perRepo.meta.contributorCount ?? 0,
        icon: perRepo.meta.icon ?? 0,
        openGraphImage: perRepo.meta.openGraphImage ?? 0,
        snapshot: perRepo.meta.snapshot ?? 0,
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
