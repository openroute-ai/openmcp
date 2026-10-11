/**
 * One-off backfill: fetch and store the README for every repository that has
 * none.
 *
 * The scheduled `update-github-data` sweep only deep-refreshes the repositories
 * an administrator has curated, and it pays for the whole per-repository bill
 * — contributor counts, mirrored assets, a star snapshot — on each one. An
 * imported catalogue arrives with READMEs empty for every repository, and
 * waiting for the next sweep to fill them in over many runs is not a workflow.
 * This does the one part that is missing, for every repository, in a single
 * pass:
 *
 *   1. read the repositories whose README was never stored;
 *   2. fetch each README from GitHub and store it.
 *
 * It is idempotent and resumable: a repository leaves the set by having its
 * README stored, so a re-run after an interruption continues from what is left.
 *
 * Rate limiting, because a few hundred REST calls back-to-back is exactly what
 * trips GitHub's limits:
 *
 *   - {@link CONCURRENCY} bounds how many requests are in flight;
 *   - {@link THROTTLE_MS} is the minimum gap between two request *starts*
 *     across the whole run, not per worker, so the request rate cannot rise
 *     with the concurrency;
 *   - a primary rate-limit response is not treated as a failure: the run waits
 *     out the reset GitHub reports and retries, up to a bounded number of
 *     times, rather than spending the rest of the budget on failing calls.
 *
 * Image mirroring is off. It is one outbound download per image and the
 * README text is all this pass is for; the stored Markdown still has its links
 * rewritten and its original image URLs, which a reader's browser resolves.
 *
 *   pnpm db:readmes
 */

import { GitHubRateLimitError } from "@/lib/github/errors"
import { loadConsoleEnv } from "./load-env"

loadConsoleEnv()

/**
 * Requests in flight at once.
 *
 * Deliberately small. GitHub's secondary ("abuse") limiter reacts to bursts
 * more than to the hourly total, and the hourly total here — a few hundred
 * calls against 5000 — is never the binding constraint.
 */
const CONCURRENCY = 3
/** Minimum gap between two request starts across the whole run. */
const THROTTLE_MS = 300
/** Bounded retries after a rate limit, so a stuck run cannot spin forever. */
const MAX_RATE_LIMIT_RETRIES = 5
/** Never wait longer than this for a reset GitHub reported as far away. */
const MAX_BACKOFF_MS = 15 * 60 * 1000

interface Logger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const logger: Logger = {
  info: (message, ...args) => console.log(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs `fetch` and, when GitHub answers with a rate limit, waits out the reset
 * and tries again.
 *
 * Only a rate limit is retried. A missing repository or an unreadable one is a
 * permanent answer for that repository and is left for the caller to record;
 * retrying it would just spend budget on the same result.
 */
async function fetchWithRateLimitBackoff<T>(
  fetch: () => Promise<T>,
  describe: string
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch()
    } catch (error) {
      if (
        !(error instanceof GitHubRateLimitError) ||
        attempt > MAX_RATE_LIMIT_RETRIES
      ) {
        throw error
      }

      // A generous minimum covers the secondary limiter, which reports a reset
      // of a second or two but expects the caller to slow down for longer.
      const reportedMs = error.retryAfterSeconds() * 1000
      const waitMs = Math.min(Math.max(reportedMs + 1000, 5000), MAX_BACKOFF_MS)
      logger.warn(
        `rate limited on ${describe}; waiting ${Math.round(waitMs / 1000)}s ` +
          `before retry ${attempt}/${MAX_RATE_LIMIT_RETRIES}`
      )
      await sleep(waitMs)
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error("CONSOLE_DATABASE_URL is required to run the backfill")
  }

  const { pool, db } = await import("./client")
  const { createGitHubClient } = await import("../lib/github/client")
  const {
    listReposMissingReadme,
    setReadme,
  } = await import("../lib/github/service/repo")
  const { processItems } = await import("../lib/tasks/iterate")

  const client = createGitHubClient()
  const missing = await listReposMissingReadme(db)
  console.log(`repositories without a README: ${missing.length}`)

  const result = await processItems(
    missing,
    async (repo) => {
      const fullName = `${repo.owner}/${repo.name}`
      const markdown = await fetchWithRateLimitBackoff(
        () =>
          client.fetchRepoReadMeAsMarkdown(fullName, repo.defaultBranch ?? undefined, {
            mirrorImages: false,
          }),
        fullName
      )

      if (!markdown) {
        // A repository with no README at the source is a real state, not a
        // failure. Counted apart so the summary can tell "nothing to store"
        // from "could not store".
        return { meta: { empty: 1 }, data: null }
      }

      await setReadme(db, repo.id, markdown)
      return { meta: { stored: 1 }, data: fullName }
    },
    { logger, label: "readme", concurrency: CONCURRENCY, throttleIntervalMs: THROTTLE_MS }
  )

  const stored = result.meta.stored ?? 0
  const empty = result.meta.empty ?? 0
  console.log(
    `stored ${stored} READMEs, ${empty} repositories have none, ` +
      `${result.errors.length} failed (of ${missing.length} attempted)`
  )

  await pool.end()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
