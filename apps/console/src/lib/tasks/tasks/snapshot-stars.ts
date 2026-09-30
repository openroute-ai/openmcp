/**
 * Sweeps stargazer timestamps into monthly star history.
 *
 * GitHub's stargazer endpoint returns one star per request page and no
 * aggregate count, so reconstructing history means walking every stargazer a
 * repository has ever had: a 200k-star repository is 2000 pages. The source
 * app did this for every repository on a schedule.
 *
 * Two things keep it affordable:
 *
 * - A repository that already has history for the current year is skipped. Its
 *   months are already recorded, and re-walking it would reproduce the same
 *   totals at the cost of thousands of requests.
 * - Repositories are processed with bounded concurrency, because the request
 *   rate, not the CPU, is the limit here.
 *
 * And one thing makes it correct rather than merely cheap: only repositories an
 * administrator has curated are swept at all. Star history is drawn on a
 * project page, so a repository nobody has curated has no chart to feed, and
 * this task is the single most expensive call to GitHub in the app. The count of
 * repositories left out is reported, for the same reason the ceiling's is.
 */

import { createGitHubClient } from "@/lib/github/client"
import { listAllRepos, listCuratedRepos } from "@/lib/github/service/repo"
import {
  accumulateStarsByMonth,
  listSnapshottedRepoIds,
  recordMonth,
  recordWeeklyStarsFromStargazers,
  type StargazerStamp,
} from "@/lib/github/service/snapshot"
import { processItems } from "@/lib/tasks/iterate"
import type { Task, TaskLogger } from "@/lib/tasks/runner"

/**
 * The stargazer endpoint is the most rate-limit-sensitive call in the app:
 * a full sweep of a large repository is thousands of pages. Serialised, with a
 * gap, so a sweep of 100 repositories cannot spend the hourly budget in
 * minutes and leave the rest of the day unable to do anything.
 */
const STARGAZER_THROTTLE_MS = 2_000

/**
 * Repositories at or above this star count are skipped by default.
 *
 * Their history is a real feature of the site, but the sweep cost is linear in
 * stars, so an unbounded sweep over a handful of very large repositories
 * monopolises the rate limit. The count is reported so the omission is
 * visible rather than silent.
 */
const DEFAULT_STAR_CEILING = 50_000

export interface SnapshotStarsOptions {
  starCeiling?: number
  /** Forces a sweep even where history already exists. */
  rebuild?: boolean
  logger?: TaskLogger
}

export function createSnapshotStarsTask(
  options: SnapshotStarsOptions = {}
): Task {
  const starCeiling = options.starCeiling ?? DEFAULT_STAR_CEILING

  return {
    name: "snapshot-stars",
    description:
      "Sweep stargazer timestamps into monthly star history for curated " +
      "repositories that do not already have it",

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

      // A repository that already has history has had this sweep done. Running
      // it again reproduces the same totals at the cost of thousands of
      // requests, so it is skipped unless a rebuild was asked for.
      const alreadySwept = options.rebuild
        ? new Set<string>()
        : new Set(await listSnapshottedRepoIds(db))

      const tooLarge: string[] = []
      const alreadyDone: string[] = []
      const candidates = repos.filter((repo) => {
        if ((repo.stars ?? 0) > starCeiling) {
          tooLarge.push(`${repo.owner}/${repo.name}`)
          return false
        }
        if (alreadySwept.has(repo.id)) {
          alreadyDone.push(`${repo.owner}/${repo.name}`)
          return false
        }
        return true
      })

      if (tooLarge.length > 0) {
        logger.warn(
          `${tooLarge.length} repo(s) above the ${starCeiling}-star ceiling were not swept`,
          tooLarge
        )
      }
      if (alreadyDone.length > 0) {
        logger.info(
          `${alreadyDone.length} repo(s) already have history and were skipped`
        )
      }

      if (candidates.length === 0) {
        return {
          considered: repos.length,
          uncurated: stored.length - repos.length,
          swept: 0,
          skippedLarge: tooLarge.length,
          skippedExisting: alreadyDone.length,
        }
      }

      const result = await processItems(
        candidates,
        async (repo) => {
          const stamps: StargazerStamp[] = []

          await client.fetchStargazersWithTimestamps(
            `${repo.owner}/${repo.name}`,
            (page) => {
              for (const entry of page) {
                stamps.push({ starredAt: entry.starred_at })
              }
            }
          )

          if (stamps.length === 0) {
            // Writing zero months here would show as a cliff in the chart, so
            // nothing is recorded for a repository that reported no stargazers.
            logger.warn(`no stargazers returned for ${repo.owner}/${repo.name}`)
            return { meta: { empty: 1 }, data: null }
          }

          const byMonth = accumulateStarsByMonth(stamps)
          for (const { yearMonth, stars } of byMonth) {
            await recordMonth(db, repo.id, yearMonth, { stars })
          }

          // The same sweep is the only moment the weekly split is knowable:
          // the raw timestamps are about to be discarded, and the monthly rows
          // cannot recover a week that straddles the 1st.
          const weeks = await recordWeeklyStarsFromStargazers(
            db,
            repo.id,
            stamps
          )

          return {
            meta: {
              swept: 1,
              months: byMonth.length,
              weeks,
              stars: stamps.length,
            },
            data: null,
          }
        },
        {
          logger,
          label: "repo",
          concurrency: 1,
          throttleIntervalMs: STARGAZER_THROTTLE_MS,
        }
      )

      return {
        considered: repos.length,
        uncurated: stored.length - repos.length,
        swept: result.meta.swept ?? 0,
        months: result.meta.months ?? 0,
        weeks: result.meta.weeks ?? 0,
        stars: result.meta.stars ?? 0,
        empty: result.meta.empty ?? 0,
        skippedLarge: tooLarge.length,
        skippedExisting: alreadyDone.length,
        errors: result.meta.error ?? 0,
      }
    },
  }
}
