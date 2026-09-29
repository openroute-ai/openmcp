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
 */

import { desc, sql } from "drizzle-orm"
import { repoWeeklyStars, snapshots } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import type { YearMonth, YearWeek } from "@/lib/github/snapshot-dates"

export type { YearMonth, YearWeek }

/** Enough history to scroll back a few years without a heavy query. */
const DEFAULT_LIMIT = 120

/**
 * Weeks with stargazer data, most recent first.
 *
 * Ordered by the two keys rather than a single computed date so the result
 * matches how the ranking task walks the weeks it has written.
 */
export async function listWeeklyPeriods(
  db: Db,
  limit = DEFAULT_LIMIT
): Promise<YearWeek[]> {
  const rows = await db
    .selectDistinct({ year: repoWeeklyStars.year, week: repoWeeklyStars.week })
    .from(repoWeeklyStars)
    .orderBy(desc(repoWeeklyStars.year), desc(repoWeeklyStars.week))
    .limit(limit)

  return rows.map((row) => ({ year: row.year, week: row.week }))
}

/**
 * Months with snapshot data, most recent first.
 *
 * Months live inside a jsonb array on a per-repository, per-year row, so
 * there is no month column to select from: the array is expanded here. That
 * expansion runs across every repository, so the distinct projection matters
 * as much as the limit.
 */
export async function listMonthlyPeriods(
  db: Db,
  limit = DEFAULT_LIMIT
): Promise<YearMonth[]> {
  const result = await db.execute<{ year: number; month: number }>(sql`
    select distinct
      (entry->>'year')::int as year,
      (entry->>'month')::int as month
    from ${snapshots},
      lateral jsonb_array_elements(
        coalesce(${snapshots.months}, '[]'::jsonb)
      ) as entry
    where entry->>'year' is not null and entry->>'month' is not null
    order by year desc, month desc
    limit ${limit}
  `)

  return result.rows.map((row) => ({ year: row.year, month: row.month }))
}
