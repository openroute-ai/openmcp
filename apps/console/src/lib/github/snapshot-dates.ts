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

import {
  APP_TIMEZONE,
  civilOf,
  instantOfCivil,
  zonedCivilDate,
  zonedMonth,
  type CivilDate,
} from "@/lib/time"

/**
 * Re-exported because it appears in this module's exported signatures. A caller
 * that has to reach into `@/lib/time` to name the argument type of
 * {@link periodFromDay} is a sign the type belongs here instead.
 */
export type { CivilDate }

const MS_PER_DAY = 86_400_000

export interface YearWeek {
  year: number
  week: number
}

export interface YearMonth {
  year: number
  month: number
}

/** The granularity a stats row is bucketed at. */
export type StatsCadence = "day" | "week" | "month"

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
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7
  )
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

/**
 * The instant a calendar period opened, as a calendar in a timezone reads it.
 *
 * A stats row is keyed by the moment its period began rather than by a year,
 * week or day number, because that moment is the thing every calendar agrees on
 * once the timezone is fixed. Storing it moves the eight hours between
 * Shanghai's midnight and UTC's out of every reader and into this one function.
 *
 * The week is the ISO week the civil date falls in, so `periodStart` and
 * `getIsoWeekNumber` cannot disagree about which week a date is in.
 */
export function periodStart(
  cadence: StatsCadence,
  civil: CivilDate,
  timeZone: string = APP_TIMEZONE
): Date {
  if (cadence === "week") {
    // The ISO week is read off the calendar date itself, not off an instant:
    // `getIsoWeekNumber` works in UTC fields, so handing it the local midnight
    // converted to UTC would ask about the previous day for anyone east of
    // Greenwich and shift every week boundary by one.
    const asUtc = new Date(Date.UTC(civil.year, civil.month - 1, civil.day))
    const monday = getIsoWeekStart(getIsoWeekNumber(asUtc))
    return instantOfCivil(
      {
        year: monday.getUTCFullYear(),
        month: monday.getUTCMonth() + 1,
        day: monday.getUTCDate(),
      },
      0,
      timeZone
    )
  }
  if (cadence === "month") {
    return instantOfCivil(
      { year: civil.year, month: civil.month, day: 1 },
      0,
      timeZone
    )
  }
  return instantOfCivil(civil, 0, timeZone)
}

/**
 * The period containing an instant.
 *
 * The inverse of {@link periodStart} and the only function a writer needs: an
 * incoming measurement is bucketed with this, and the row is keyed by the
 * result.
 */
export function periodOf(
  instant: Date,
  cadence: StatsCadence,
  timeZone: string = APP_TIMEZONE
): Date {
  return periodStart(cadence, civilOf(instant, timeZone), timeZone)
}

/** Every period from the one containing `from` through the one containing `to`. */
export function periodRange(
  from: Date,
  to: Date,
  cadence: StatsCadence,
  timeZone: string = APP_TIMEZONE
): Date[] {
  const periods: Date[] = []
  for (
    let cursor = periodOf(from, cadence, timeZone);
    cursor.getTime() <= to.getTime();
    cursor = nextPeriod(cursor, cadence, timeZone)
  ) {
    periods.push(cursor)
  }
  return periods
}

/**
 * The period after the one that opened at `start`.
 *
 * Adding milliseconds would be wrong for any zone with a DST transition inside
 * the period, so the step is taken in calendar fields and converted back — the
 * same route `periodStart` takes.
 */
export function nextPeriod(
  start: Date,
  cadence: StatsCadence,
  timeZone: string = APP_TIMEZONE
): Date {
  if (cadence === "month") {
    const { year, month } = zonedMonth(start, timeZone)
    return periodStart(
      "month",
      month === 12
        ? { year: year + 1, month: 1, day: 1 }
        : { year, month: month + 1, day: 1 },
      timeZone
    )
  }
  return periodStart(
    cadence,
    shiftCivil(civilOf(start, timeZone), cadence === "week" ? 7 : 1),
    timeZone
  )
}

/** A calendar date moved by whole days, staying a calendar date. */
function shiftCivil(civil: CivilDate, days: number): CivilDate {
  const shifted = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day + days)
  )
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/**
 * The ISO week a period is named by.
 *
 * Read through the calendar rather than through `period.getUTCDay()`: a week that
 * starts on Shanghai's Monday opens at `Sunday 16:00Z`, so the UTC fields would
 * call it a Sunday and shift every week label back by one.
 */
export function weekOfPeriod(
  period: Date,
  timeZone: string = APP_TIMEZONE
): YearWeek {
  const civil = civilOf(period, timeZone)
  return getIsoWeekNumber(
    new Date(Date.UTC(civil.year, civil.month - 1, civil.day))
  )
}

/** The month a period is named by, read through the same calendar. */
export function monthOfPeriod(
  period: Date,
  timeZone: string = APP_TIMEZONE
): YearMonth {
  const civil = civilOf(period, timeZone)
  return { year: civil.year, month: civil.month }
}

/**
 * The last `count` months, oldest first, ending with the month before `now`.
 *
 * Ends on the previous month because a month is only complete at its end:
 * charting the current one would draw a bar that is short for a reason having
 * nothing to do with the project, and would move every time the page reloaded.
 *
 * The cursor walks in calendar fields from the first of the current month. That
 * pinning matters: stepping back from 31 May would otherwise aim at 31 April,
 * and a date that does not exist overflows forward into May again, charting the
 * same month twice and dropping one from the end.
 */
export function lastNMonths(
  count: number,
  now: Date,
  timeZone: string = APP_TIMEZONE
): YearMonth[] {
  const months: YearMonth[] = []
  const start = civilOf(now, timeZone)
  let { year, month } = start

  for (let index = 0; index < count; index++) {
    if (month === 1) {
      year -= 1
      month = 12
    } else {
      month -= 1
    }
    months.push({ year, month })
  }

  return months.reverse()
}

/**
 * The last `count` ISO weeks, oldest first, ending with the one containing `now`.
 *
 * Unlike the months, the week containing today *is* charted: a week is not over
 * until it is, but the chart's job is to show what is happening this week, and
 * the stored change for an open week is the movement so far.
 */
export function lastNWeeks(
  count: number,
  now: Date,
  timeZone: string = APP_TIMEZONE
): YearWeek[] {
  const weeks: YearWeek[] = []
  const civil = civilOf(now, timeZone)
  let cursor = Date.UTC(civil.year, civil.month - 1, civil.day)

  for (let index = 0; index < count; index++) {
    weeks.push(getIsoWeekNumber(new Date(cursor)))
    cursor -= MS_PER_DAY * 7
  }

  return weeks.reverse()
}

/** The instant a named period opens. The inverse of the two functions above. */
export function periodFromMonth(
  yearMonth: YearMonth,
  timeZone: string = APP_TIMEZONE
): Date {
  return periodStart(
    "month",
    { year: yearMonth.year, month: yearMonth.month, day: 1 },
    timeZone
  )
}

/**
 * The instant a named calendar day opens.
 *
 * The third of the three named-period openers, and the one the daily stats
 * table is keyed by. It exists rather than being spelled at each call site
 * because a day boundary is the one period where "the ISO week the civil date
 * falls in" and "the civil date" are not the same question — getting it wrong
 * shifts a day rather than a week, which is much harder to notice in a chart.
 */
export function periodFromDay(
  civil: CivilDate,
  timeZone: string = APP_TIMEZONE
): Date {
  return periodStart("day", civil, timeZone)
}

/**
 * The instant a named ISO week opens.
 *
 * An ISO year has 53 weeks only when it is short a day for the last week to
 * close, which the ISO arithmetic already knows; asking `getIsoWeekStart` is
 * therefore exact where reconstructing a Monday by arithmetic would need both
 * of those rules remembered.
 */
export function periodFromWeek(
  yearWeek: YearWeek,
  timeZone: string = APP_TIMEZONE
): Date {
  const monday = getIsoWeekStart(yearWeek)
  return periodStart(
    "week",
    {
      year: monday.getUTCFullYear(),
      month: monday.getUTCMonth() + 1,
      day: monday.getUTCDate(),
    },
    timeZone
  )
}

/**
 * The most recent period that has finished, in the team's timezone.
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
 *
 * The calendar is Beijing's, not the server's. A server on UTC is still on
 * Sunday at Beijing Monday 00:30, and asking it for the last complete week
 * there answers with the week before last — eight hours a day of publishing a
 * ranking for the wrong seven days, and the same off-by-one at every month and
 * year boundary.
 */
export function lastCompletePeriod(period: "week", now: Date): YearWeek
export function lastCompletePeriod(period: "month", now: Date): YearMonth
export function lastCompletePeriod(
  period: "week" | "month",
  now: Date
): YearWeek | YearMonth {
  const civil = zonedCivilDate(now)

  if (period === "week") {
    // Seven days back, not one. Yesterday is only in the previous week when
    // today is a Monday; from any other weekday it is still the current week,
    // which would publish the week being ranked right now.
    const lastWeek = new Date(civil.getTime() - 7 * 24 * 60 * 60 * 1000)
    return getIsoWeekNumber(lastWeek)
  }

  const thisMonth = monthOf(civil)
  return thisMonth.month === 1
    ? { year: thisMonth.year - 1, month: 12 }
    : { year: thisMonth.year, month: thisMonth.month - 1 }
}
