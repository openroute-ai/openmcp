/**
 * Publishes the weekly and monthly rankings.
 *
 * One implementation for both periods. The source app carried two files that
 * differed only in the period they named and the delta they computed, and had
 * already drifted: the weekly one threw when a repository had no project while
 * the monthly one did not, and only the weekly one checked for snapshots at
 * all.
 *
 * The period defaults to the one that just ended. Building the current week
 * would rank a partial week against complete ones, which makes whatever is
 * happening right now look like a collapse; the source had this wrong for
 * weeks because `isLatest: true` was hardcoded rather than derived.
 *
 * Publishing is optional. Without OSS credentials the task still builds the
 * rankings and reports what it would have written, rather than failing a run
 * that did all the real work.
 */

import { buildRankingsForMonth, buildRankingsForWeek } from "@/lib/github/service/rankings"
import {
  getIsoWeekNumber,
  monthOf,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import { ossClient } from "@/lib/oss/client"
import type { Task } from "@/lib/tasks/runner"

export interface RankingsStore {
  saveJSON(json: unknown, fileName: string): Promise<string | undefined>
}

export function createBuildRankingsTask(
  period: "week" | "month",
  store: RankingsStore = ossClient
): Task {
  const name = `build-${period === "week" ? "weekly" : "monthly"}-rankings`

  return {
    name,
    description: `Build ${period} rankings to be displayed on the frontend`,

    async run({ db, logger }) {
      // A week that has not finished is partial, and a month that has not
      // finished likewise, so both default to the last complete period.
      const target = lastCompletePeriod(period, new Date())
      const rankings =
        period === "week"
          ? await buildRankingsForWeek(db, target as YearWeek)
          : await buildRankingsForMonth(db, target as YearMonth)

      if (rankings.trending.length === 0) {
        // Publishing an empty ranking would overwrite a good one with a file
        // claiming nothing moved, which reads as a real result to a consumer.
        logger.warn(
          `no ranked projects for ${period} ${formatPeriod(target)}; keeping the previous file`
        )
        return {
          period,
          published: false,
          trending: 0,
          byRelativeGrowth: 0,
          reason: "no data for period",
        }
      }

      const fileName = periodFileName(target)
      const url = await store.saveJSON(rankings, fileName)

      if (!url) {
        // No bucket configured. The build succeeded; only publication did not.
        logger.warn(`OSS is not configured; built ${fileName} without publishing`)
      } else {
        logger.info(
          `published ${fileName}: ${rankings.trending.length} trending, ` +
            `${rankings.byRelativeGrowth.length} by growth`
        )
      }

      return {
        period,
        year: target.year,
        ...("week" in target ? { week: target.week } : { month: target.month }),
        published: Boolean(url),
        trending: rankings.trending.length,
        byRelativeGrowth: rankings.byRelativeGrowth.length,
      }
    },
  }
}

function formatPeriod(period: YearWeek | YearMonth): string {
  return "week" in period
    ? `W${String(period.week).padStart(2, "0")}`
    : `-${String(period.month).padStart(2, "0")}`
}

/**
 * The OSS path a ranking is published under, matching what the frontend
 * fetches: `weekly/2026/2026-W09.json` and `monthly/2026/2026-02.json`.
 *
 * Kept symmetrical with the source app's naming, because the public site
 * already enumerates these directories and a consumer that loaded last
 * month's file will not retry and find this one under a different name.
 */
export function periodFileName(target: YearWeek | YearMonth): string {
  const name = "week" in target
    ? `${target.year}-W${String(target.week).padStart(2, "0")}`
    : `${target.year}-${String(target.month).padStart(2, "0")}`
  const directory = "week" in target ? "weekly" : "monthly"
  return `${directory}/${target.year}/${name}.json`
}

/**
 * The most recent period that has finished.
 *
 * A week runs Monday to Sunday and a month runs to its last day, so both are
 * taken as "the one before the current one". Ranking a period that is still
 * accumulating against complete periods is how a trending list ends up led by
 * whatever happened in the last two days: the partial period has less time to
 * accumulate, so it looks like a collapse.
 *
 * Always the previous period, including on the final day of a month, so the
 * rule has no boundary case where a half-completed period is published a day
 * early.
 */
export function lastCompletePeriod(
  period: "week" | "month",
  now: Date
): YearWeek | YearMonth {
  if (period === "week") {
    // Seven days back, not one. Yesterday is only in the previous week when
    // today is a Monday; from any other weekday it is still the current week,
    // which would publish the week being ranked right now.
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return getIsoWeekNumber(lastWeek)
  }

  const thisMonth = monthOf(now)
  return thisMonth.month === 1
    ? { year: thisMonth.year - 1, month: 12 }
    : { year: thisMonth.year, month: thisMonth.month - 1 }
}
