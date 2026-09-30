/**
 * Date helpers shared by the ranking pages.
 *
 * All functions return `YYYY-MM-DD` in local time, which is the format the
 * ranking snapshots are keyed by. They live outside the components so the
 * period navigation and the summary lists agree on where a week starts.
 */

/** `YYYY-MM-DD` for `daysAgo` days before today, local time. */
export function formatDateKey(daysAgo = 0): string {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return toLocalDateKey(date)
}

/** Local-midnight `Date` for a `YYYY-MM-DD` key, falling back to today if malformed. */
function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return new Date()
  return new Date(year, month - 1, day)
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Monday of the week containing `date`, as a `Date`. */
function startOfWeek(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  const dayOfWeek = result.getDay()
  result.setDate(result.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek))
  return result
}

/**
 * The most recently completed week/month, i.e. the newest snapshot the cron
 * would have written. The page shows finished periods rather than the in-flight
 * one, since today's numbers are not complete until 23:59.
 */
export function lastWeekStart(): string {
  const thisWeekStart = startOfWeek(new Date())
  thisWeekStart.setDate(thisWeekStart.getDate() - 7)
  return toLocalDateKey(thisWeekStart)
}

export function lastMonthStart(): string {
  const now = new Date()
  return toLocalDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}

export type RankingPeriod = 'daily' | 'weekly' | 'monthly'

/**
 * The canonical key a period's snapshot is filed under, matching the cron's
 * anchor: daily → the day, weekly → the Monday, monthly → the 1st.
 *
 * Applied before navigating so switching from a daily view into the weekly tab
 * lands on a Monday rather than on the same day-of-week the visitor came from.
 */
export function alignPeriodKey(period: RankingPeriod, key: string): string {
  const date = parseDateKey(key)

  if (period === 'weekly') return toLocalDateKey(startOfWeek(date))
  if (period === 'monthly') return toLocalDateKey(new Date(date.getFullYear(), date.getMonth(), 1))
  return toLocalDateKey(date)
}

/** Step a period key backwards by `delta` steps, re-aligning to the new anchor. */
export function shiftPeriod(period: RankingPeriod, key: string, delta: number): string {
  const date = parseDateKey(key)

  if (period === 'daily') {
    date.setDate(date.getDate() + delta)
  } else if (period === 'weekly') {
    date.setDate(date.getDate() + delta * 7)
  } else {
    date.setMonth(date.getMonth() + delta, 1)
  }

  return alignPeriodKey(period, toLocalDateKey(date))
}
