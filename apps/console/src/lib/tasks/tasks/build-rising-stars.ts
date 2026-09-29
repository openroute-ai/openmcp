/**
 * Builds the Rising Stars report and publishes it.
 *
 * An unscheduled, source-side task made this in the old app by reading a
 * sibling application's category JSON and writing a single "rising-stars.json"
 * next to the site's other artefacts. Here it is a first-class scheduled
 * task: categories live in the database and the computed list is persisted
 * per year before the JSON artefact is (optionally) published.
 *
 * The default year is the last complete one, so a run in January reports the
 * year that just ended. Publishing is optional, like the rankings build:
 * without OSS credentials the report still computes and persists, and the run
 * reports what it would have written rather than failing.
 */

import { buildRisingStarsForYear } from "@/lib/github/service/rising-stars"
import { ossClient } from "@/lib/oss/client"
import type { RankingsStore } from "@/lib/tasks/tasks/build-rankings"
import type { Task } from "@/lib/tasks/runner"
import { SKIP_CODES } from "@/lib/trpc/error-codes"

export interface BuildRisingStarsOptions {
  /** Defaults to the last complete year. */
  year?: number
  store?: RankingsStore
  now?: () => Date
}

export function createBuildRisingStarsTask(
  options: BuildRisingStarsOptions = {}
): Task {
  return {
    name: "build-rising-stars",
    description: "Build the Rising Stars report and publish it",

    async run({ db, logger }) {
      const now = options.now ?? (() => new Date())
      const store = options.store ?? ossClient
      const year = options.year ?? now().getFullYear() - 1

      const report = await buildRisingStarsForYear(db, year, now())

      if (report.projects.length === 0) {
        // Publishing an empty report would overwrite a good one. The previous
        // year's rows stay in the table, and the artefact is not replaced.
        logger.warn(
          `no growing projects in ${year}; keeping the previous report`
        )
        return {
          year,
          count: 0,
          published: false,
          reason: "no data for year",
          reasonCode: SKIP_CODES.noDataForYear,
        }
      }

      const url = await store.saveJSON(
        {
          date: report.date,
          count: report.count,
          projects: report.projects,
          tags: report.tags,
        },
        "rising-stars.json"
      )

      if (!url) {
        logger.warn(
          "OSS is not configured; built rising-stars.json without publishing"
        )
      } else {
        logger.info(
          `published rising-stars.json: ${report.projects.length} projects`
        )
      }

      return {
        year,
        count: report.projects.length,
        tags: report.tags.length,
        published: Boolean(url),
      }
    },
  }
}
