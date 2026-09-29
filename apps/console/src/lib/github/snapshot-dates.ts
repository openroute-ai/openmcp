/**
 * ISO-8601 week and month arithmetic for the ranking history.
 *
 * The source app computed week *numbers* with the ISO-8601 algorithm but
 * derived week *boundaries* by adding seven-day offsets to 1 January and
 * then backing up to Monday. The two definitions disagree, so a snapshot
 * from late December could land outside the week whose number it was filed
 * under, and weekly deltas near a year boundary were computed over the
 * wrong window. Everything here derives from one definition.
 */

const MS_PER_DAY = 86_400_000

export interface YearWeek {
  year: number
  week: number
}

export interface YearMonth {
  year: number
  month: number
}

/** Normalises a date to UTC midnight, dropping the time component. */
function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

/**
 * ISO-8601 week number: weeks start on Monday, and week 1 is the week
 * containing the first Thursday of the year. That definition puts 1 January
 * 2021 in week 53 of 2020, which is the behaviour a week-over-week
 * comparison needs in order to line up across the boundary.
 */
export function getIsoWeekNumber(date: Date): YearWeek {
  const target = utcMidnight(date)
  // Shift to the Thursday of this week; its calendar year is the ISO year.
  const dayOfWeek = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayOfWeek)

  const isoYear = target.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week =
    Math.ceil(((target.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
  return { year: isoYear, week }
}

/**
 * First day (Monday) of the given ISO week, at UTC midnight.
 *
 * A year does not always have 53 ISO weeks - 2021 and 2022 have 52 - so
 * asking for week 53 of such a year has no answer and rolls into the
 * following year's week 1. Callers should take week numbers from
 * `getIsoWeekNumber` rather than computing them, which is what keeps this
 * from mattering in practice.
 */
export function getIsoWeekStart({ year, week }: YearWeek): Date {
  // 4 January is always in ISO week 1.
  const january4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = january4.getUTCDay() || 7
  const monday = new Date(january4)
  monday.setUTCDate(january4.getUTCDate() - (dayOfWeek - 1))

  const result = new Date(monday)
  result.setUTCDate(monday.getUTCDate() + (week - 1) * 7)
  return result
}

/** Last day (Sunday) of the given ISO week, at UTC midnight. */
export function getIsoWeekEnd(yearWeek: YearWeek): Date {
  const end = getIsoWeekStart(yearWeek)
  end.setUTCDate(end.getUTCDate() + 6)
  return end
}

/** True when a date falls inside the given ISO week. */
export function isInIsoWeek(date: Date, yearWeek: YearWeek): boolean {
  const target = utcMidnight(date).getTime()
  return (
    target >= getIsoWeekStart(yearWeek).getTime() &&
    target <= getIsoWeekEnd(yearWeek).getTime()
  )
}

/** The year and month a date belongs to, in UTC. */
export function getYearMonth(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

/**
 * The ISO week immediately before the given one.
 *
 * Needed by the weekly ranking, which compares a week against the one before
 * it. Derived by asking the calendar rather than by subtracting from the week
 * number, because week 1 of a year is preceded by the last week of the year
 * before, and that year may have had 52 or 53 weeks.
 */
export function previousIsoWeek(yearWeek: YearWeek): YearWeek {
  // The Sunday before this week's Monday is inside the previous ISO week, so
  // `getIsoWeekNumber` reads the right answer off it, whatever the year does.
  const monday = getIsoWeekStart(yearWeek)
  return getIsoWeekNumber(new Date(monday.getTime() - MS_PER_DAY))
}

/** Clamps a month to 1-12, so a bad input cannot produce a phantom month. */
function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Month must be an integer in 1-12, received ${month}`)
  }
}

/**
 * The instant a month starts, at UTC midnight.
 *
 * Monthly download figures are published by npm against UTC day
 * boundaries, so bucketing by local time would shift a whole day's volume
 * between months for anyone east or west of UTC.
 */
export function monthStart({ year, month }: YearMonth): Date {
  assertMonth(month)
  return new Date(Date.UTC(year, month - 1, 1))
}

/** The instant after a month ends, at UTC midnight on the first of the next. */
export function monthEndExclusive({ year, month }: YearMonth): Date {
  assertMonth(month)
  return new Date(Date.UTC(year, month, 1))
}

/** True when a date falls inside the given month. */
export function isInMonth(date: Date, yearMonth: YearMonth): boolean {
  const target = date.getTime()
  return (
    target >= monthStart(yearMonth).getTime() &&
    target < monthEndExclusive(yearMonth).getTime()
  )
}

/** The month containing a date. */
export function monthOf(date: Date): YearMonth {
  return getYearMonth(date)
}

/** Number of days in a month, leap years included. */
export function daysInMonth({ year, month }: YearMonth): number {
  assertMonth(month)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Counts whole days from `from` to `to`, never negative.
 *
 * Ranking deltas are "how much did this grow", so a snapshot that predates
 * the window (because a repository was created mid-period) contributes zero
 * rather than a negative count that would penalise a fast riser.
 */
export function countDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY))
}
