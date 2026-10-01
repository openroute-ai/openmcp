/**
 * The periods that have ranking data.
 *
 * The ranking builders default to the last complete period, which is right for
 * the public endpoints but useless for an operator looking at history: the
 * dashboard can only ever show one week and one month unless it is told which
 * ones exist. This lists them so the UI can offer real choices instead of a
 * grid of dates that mostly render empty.
 *
 * Only periods that actually hold rows are returned. A week present in the
 * calendar but absent from the table would produce an empty ranking, and
 * offering it would look like data loss rather than a period never swept.
 *
 * The tables store the instant a period opened, so the year, week or month a
 * caller asks for is recovered by reading that instant back through the calendar
 * it was written in. Reading it through UTC would report every period one earlier
 * than it was filed, because a Shanghai week opens on Sunday evening UTC.
 */

import {
  monthOfPeriod,
  periodFromMonth,
  periodFromWeek,
  weekOfPeriod,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import {
  listMonthlyPeriodStarts,
  listWeeklyPeriodStarts,
} from "@/lib/github/service/stats"
import type { Db } from "@/lib/github/service/repo"

export type { YearMonth, YearWeek }

/** Enough history to scroll back a few years without a heavy query. */
const DEFAULT_LIMIT = 120

/** Weeks with stats data, most recent first. */
export async function listWeeklyPeriods(
  db: Db,
  limit = DEFAULT_LIMIT
): Promise<YearWeek[]> {
  return (await listWeeklyPeriodStarts(db, limit)).map((period) =>
    weekOfPeriod(period)
  )
}

/** Months with stats data, most recent first. */
export async function listMonthlyPeriods(
  db: Db,
  limit = DEFAULT_LIMIT
): Promise<YearMonth[]> {
  return (await listMonthlyPeriodStarts(db, limit)).map((period) =>
    monthOfPeriod(period)
  )
}

/**
 * The instant a named period opens, for a caller that already holds a year and a
 * week or a month.
 *
 * Exposed next to the readers above because the two directions have to agree:
 * a dashboard that lists week 10 and then asks the ranking builder about week 10
 * gets the same row whichever way the name is converted, or the list offers a
 * period the ranking cannot find.
 */
export { periodFromMonth, periodFromWeek }