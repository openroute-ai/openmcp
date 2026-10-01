/**
 * Records star history from GitHub's weekly buckets, and stargazers from the
 * stargazer list.
 *
 * GitHub offers two ways to answer "how did this repository's stars change",
 * and this task runs both:
 *
 * - `GET /stargazers/history` returns a week per request with the cumulative
 *   count at its end and a seven-day breakdown inside it. One page covers thirty
 *   weeks, and `page` is capped at a hundred, so one repository's whole history
 *   costs a handful of requests regardless of how many stars it has. This is the
 *   primary source, and it is what `recordStarHistory` writes.
 * - `GET /stargazers` returns one stargazer per row, so the same question costs
 *   one request per hundred stars — four hundred requests for a 40k-star
 *   repository. It is kept because it is the only source that says *who* starred.
 *
 * The asymmetry drives the schedule. History is cheap enough to run for every
 * repository every day; the stargazer walk is not, so it runs for repositories
 * whose token can read them and resumes from the newest timestamp already stored
 * rather than re-walking from the beginning.
 *
 * Writer ownership is the reason the details below matter. This task owns a
 * repository's *closed* periods — the levels, net changes and arrivals before
 * today. The daily sampler owns the periods that are still open, because it
 * reads the repository's own star count and that is more recent than the last
 * complete bucket. See `recordStarHistory`.
 */
import { GitHubForbiddenError, GitHubRateLimitError } from "@/lib/github/errors"
import { createGitHubClient } from "@/lib/github/client"
import { listAllRepos, listCuratedRepos } from "@/lib/github/service/repo"
import {
  latestStargazerAt,
  listReposWithDailyStats,
  recordStargazers,
  recordStarHistory,
} from "@/lib/github/service/stats"
import { processItems } from "@/lib/tasks/iterate"
import type { Task, TaskLogger } from "@/lib/tasks/runner"

/**
 * A gap between history requests.
 *
 * The history endpoint is cheap, so the throttle here is small and exists only
 * to keep a sweep of thousands of repositories from looking like an attack. The
 * stargazer walk behind the supplement gets a much larger gap below.
 */
const HISTORY_THROTTLE_MS = 250

/**
 * A gap between stargazer requests.
 *
 * This is the most rate-limit-sensitive call in the app — a full walk of a large
 * repository is thousands of pages — so it is serialised with a wide gap, letting
 * a sweep spend minutes rather than exhausting the hourly budget and leaving the
 * rest of the day unable to do anything.
 */
const STARGAZER_THROTTLE_MS = 2_000

export interface SnapshotStarsOptions {
  /**
   * Forces the history sweep for repositories that already have daily rows.
   *
   * Off by default: the daily sampler keeps today's row current, and re-reading
   * history for every repository every day would be requests spent re-deriving
   * what is already stored.
   */
  rebuild?: boolean
  /** Skips the stargazer supplement entirely. */
  skipStargazers?: boolean
  /** How many history pages to request per repository. */
  historyPages?: number
  logger?: TaskLogger
}

export function createSnapshotStarsTask(
  options: SnapshotStarsOptions = {}
): Task {
  return {
    name: "snapshot-stars",
    description:
      "Record star history from GitHub's weekly buckets for repositories that " +
      "do not yet have daily rows, and store stargazers where the token can " +
      "read them",

    async run({ db, logger }) {
      const client = createGitHubClient()
      const stored = await listAllRepos(db)
      const repos = await listCuratedRepos(db)

      if (repos.length < stored.length) {
        // Reported rather than silent: the gap between these two numbers is the
        // set of collected-but-unpublished repositories this task is not
        // touching, and an operator comparing star counts against history needs
        // to know which set they are in.
        logger.info(
          `${stored.length - repos.length} uncurated repo(s) were not considered`
        )
      }

      // A repository that already has daily rows has had its history recorded.
      // Running the sweep again reproduces the same numbers at the cost of a
      // request per week of its history, so it is skipped unless a rebuild was
      // asked for.
      const alreadySwept = options.rebuild
        ? new Set<string>()
        : new Set(await listReposWithDailyStats(db))

      const alreadyDone = repos.filter((repo) => alreadySwept.has(repo.id))

      if (alreadyDone.length > 0) {
        logger.info(
          `${alreadyDone.length} repo(s) already have history and were skipped`
        )
      }

      const candidates = repos.filter((repo) => !alreadySwept.has(repo.id))

      const history = await processItems(
        candidates,
        async (repo) => {
          const entries = await client.fetchStarHistory(
            `${repo.owner}/${repo.name}`,
            options.historyPages === undefined
              ? {}
              : { pages: options.historyPages }
          )

          if (entries.length === 0) {
            // Writing nothing here would show as a cliff in the chart, so no
            // rows are recorded for a repository that reported no history.
            logger.warn(
              `no star history returned for ${repo.owner}/${repo.name}`
            )
            return { meta: { empty: 1 }, data: null }
          }

          const written = await recordStarHistory(db, repo.id, entries)

          return {
            meta: {
              swept: 1,
              days: written,
              weeks: entries.length,
              stars: entries[entries.length - 1]?.total ?? 0,
            },
            data: null,
          }
        },
        {
          logger,
          label: "history",
          concurrency: 4,
          throttleIntervalMs: HISTORY_THROTTLE_MS,
        }
      )

      const stargazers = options.skipStargazers
        ? { stored: 0, forbidden: 0, errors: 0, repos: 0 }
        : await sweepStargazers(db, client, logger)

      return {
        considered: repos.length,
        uncurated: stored.length - repos.length,
        swept: history.meta.swept ?? 0,
        days: history.meta.days ?? 0,
        weeks: history.meta.weeks ?? 0,
        stars: history.meta.stars ?? 0,
        empty: history.meta.empty ?? 0,
        skippedExisting: alreadyDone.length,
        errors: (history.meta.error ?? 0) + stargazers.errors,
        stargazerRepos: stargazers.repos,
        stargazers: stargazers.stored,
        stargazerForbidden: stargazers.forbidden,
      }
    },
  }
}

/**
 * Walks the stargazer list, resuming from what is already stored.
 *
 * Two outcomes are distinguished on purpose. A 403 that is not a rate limit
 * means the token cannot read this repository's stargazers — an expected result
 * for any repository it is not an administrator of, and skipped without
 * recording anything. A rate-limited 403 stops the repository, because
 * continuing would spend a budget that is already gone and would record the
 * silence as "no stargazers".
 *
 * `since` is the newest timestamp stored, so a second pass costs the handful of
 * stargazers who arrived since rather than the whole history. The stored
 * timestamp is the one to resume from rather than a date the caller invents,
 * because a gap in the middle of the walk cannot be repaired by a later pass
 * that starts after it.
 */
async function sweepStargazers(
  db: Parameters<typeof recordStargazers>[0],
  client: ReturnType<typeof createGitHubClient>,
  logger: TaskLogger
): Promise<{
  stored: number
  forbidden: number
  errors: number
  repos: number
}> {
  const repos = await listCuratedRepos(db)

  const result = await processItems(
    repos,
    async (repo) => {
      const since = await latestStargazerAt(db, repo.id)

      const entries: { login: string; starredAt: Date }[] = []
      try {
        await client.fetchStargazersWithTimestamps(
          `${repo.owner}/${repo.name}`,
          (page) => {
            for (const entry of page) {
              entries.push({
                login: entry.login,
                starredAt: new Date(entry.starred_at),
              })
            }
          },
          since ? { since } : {}
        )
      } catch (error) {
        if (
          error instanceof GitHubForbiddenError &&
          !(error instanceof GitHubRateLimitError)
        ) {
          // Expected for any repository the token cannot administer, so counted
          // and moved past rather than retried.
          logger.info(`stargazers not readable for ${repo.owner}/${repo.name}`)
          return { meta: { forbidden: 1 }, data: null }
        }
        // A rate limit is deliberately rethrown: `processItems` records the
        // error and moves on, but the task result reports it, so a throttled
        // sweep is visible as throttled rather than as a repository with no
        // stargazers.
        throw error
      }

      const written = await recordStargazers(db, repo.id, entries)
      return { meta: { stored: written, repos: 1 }, data: null }
    },
    {
      logger,
      label: "stargazers",
      concurrency: 1,
      throttleIntervalMs: STARGAZER_THROTTLE_MS,
    }
  )

  return {
    stored: result.meta.stored ?? 0,
    forbidden: result.meta.forbidden ?? 0,
    errors: result.meta.error ?? 0,
    repos: result.meta.repos ?? 0,
  }
}
