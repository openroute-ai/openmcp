import type { RankingPeriod } from '@/web/workflow-rankings'

/**
 * Which window a ranking cron run should recompute.
 *
 * The default is the most recently *finished* period of the requested kind, so
 * an unqualified run never publishes a half-counted window. A caller that
 * genuinely wants a different window — a backfill, or a forced recompute of an
 * in-flight period — passes an explicit `date`.
 */

const toKey = (date: Date) => date.toISOString().slice(0, 10)

/** Monday of the week containing `date`, at midnight. */
function alignToWeekStart(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  const dayOfWeek = result.getDay()
  result.setDate(result.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek))
  return result
}

/**
 * Inclusive `[startDate, endDate]` bounds.
 *
 * For daily/weekly the day is interpreted in the server's local timezone, which
 * is the timezone the scheduler is configured for; passing an explicit
 * `date` therefore re-derives the surrounding period rather than trusting the
 * caller's arithmetic.
 */
export function resolveRankingWindow(
  period: RankingPeriod,
  dateParam: string | null
): { startDate: Date; endDate: Date } {
  const now = new Date()

  if (!dateParam) {
    if (period === 'daily') {
      const endDate = new Date(now)
      endDate.setDate(endDate.getDate() - 1)
      endDate.setHours(23, 59, 59, 999)
      const startDate = new Date(endDate)
      startDate.setHours(0, 0, 0, 0)
      return { startDate, endDate }
    }

    if (period === 'weekly') {
      const endDate = new Date(now)
      const dayOfWeek = endDate.getDay()
      // Walk back to Sunday of the current week, then to the previous week.
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
      endDate.setDate(endDate.getDate() - daysSinceMonday - 1)
      endDate.setHours(23, 59, 59, 999)
      const startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 6)
      startDate.setHours(0, 0, 0, 0)
      return { startDate, endDate }
    }

    const endDate = new Date(now.getFullYear(), now.getMonth(), 0)
    endDate.setHours(23, 59, 59, 999)
    return { startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1), endDate }
  }

  // Callers validate the shape with `isValidRankingDate`, but the regex only
  // bounds the string, so the parsed values are still `number | undefined`
  // under `noUncheckedIndexedAccess`. Falling back to today keeps an
  // out-of-contract caller on the default path instead of building an
  // `Invalid Date`.
  const [year, month, day] = dateParam.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    return resolveRankingWindow(period, null)
  }

  const requested = new Date(year, month - 1, day)
  if (Number.isNaN(requested.getTime())) {
    return resolveRankingWindow(period, null)
  }
  requested.setHours(0, 0, 0, 0)

  if (period === 'daily') {
    const endDate = new Date(requested)
    endDate.setHours(23, 59, 59, 999)
    return { startDate: requested, endDate }
  }

  if (period === 'weekly') {
    const startDate = alignToWeekStart(requested)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 6)
    endDate.setHours(23, 59, 59, 999)
    return { startDate, endDate }
  }

  const endDate = new Date(year, month, 0)
  endDate.setHours(23, 59, 59, 999)
  return { startDate: new Date(year, month - 1, 1), endDate }
}

/** True when the window extends past now, i.e. the period is still running. */
export function isWindowIncomplete(window: { startDate: Date; endDate: Date }): boolean {
  return window.endDate.getTime() > Date.now()
}

export const isValidRankingDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

export { toKey as toDateKey }
