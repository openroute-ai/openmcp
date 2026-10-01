/**
 * Cadences, periods, and the catch-up rule.
 *
 * Vercel wakes this app once a day, so a task's own cron expression cannot be
 * the thing that decides when it runs. Instead every task belongs to a cadence
 * — daily, weekly, monthly, yearly — and to the *period* of that cadence its
 * work belongs to: the day, the ISO week, the month, or the year. A task is due
 * when the period it belongs to has arrived, that period has no successful run,
 * and it has not spent its attempts.
 *
 * The period is the one that is *due*, not always the current one, and that is
 * the whole trick. A task scheduled for 04:00, woken at 02:00, belongs to the
 * day that was due at 04:00 — the day before. So one daily wake-up can stand in
 * for fifteen separate schedules: a task whose slot has already passed today
 * runs for today, and one whose slot has not arrived yet catches up on the day
 * it was missed instead of quietly never running at all.
 *
 * That also makes a missed run recover by itself. There is no state to expire
 * and no cleanup job: the period a task belongs to is derived from the clock
 * and its own expression, so a wake-up that arrives after a deployment
 * outage, a failed task, or a missed week still finds the outstanding work.
 *
 * Ordering within a period is a property of the seeds, not of this file — see
 * `sortBySeedOrder`.
 */

import { instantOfCivil } from "@/lib/time"
import {
  parseCron,
  SCHEDULE_TIMEZONE,
  zonedParts,
  type CronFields,
} from "@/lib/tasks/definitions"
import { VERCEL_CRON_SCHEDULE } from "@/lib/tasks/vercel-cron"

export const TASK_CADENCES = ["daily", "weekly", "monthly", "yearly"] as const

export type TaskCadence = (typeof TASK_CADENCES)[number]

/** How many times one period may be attempted before it is given up on. */
export const MAX_ATTEMPTS_PER_PERIOD = 3

/** The fields of a schedule, however they were stored. */
export interface ScheduleDefinition {
  name?: string
  taskType?: string | null
  cronExpression?: string | null
  isDaily?: boolean | null
  isWeekly?: boolean | null
  isMonthly?: boolean | null
}

export interface PeriodTarget {
  cadence: TaskCadence
  /**
   * The period's identity: `2026-03-11`, `2026-03-09` (the week's Monday),
   * `2026-03`, or `2026`.
   *
   * Reported by the Cron tick and recorded against a run, so a period can be
   * read back out of the history later without re-deriving it.
   */
  key: string
  /** The instant the period opened, in UTC. */
  start: Date
}

interface CalendarDate {
  year: number
  month: number
  day: number
}

/**
 * The cadence a definition belongs to.
 *
 * `taskType` is the field the source scheduler carried, so it is the truth
 * when it is one of the four; the boolean flags are what older rows have; and
 * an expression that is not classified either way still gets the cadence its
 * own shape implies. A definition with none of those is not schedulable, which
 * returns undefined rather than guessing — running an unknown task daily is
 * worse than not running it.
 */
export function cadenceOf(
  definition: ScheduleDefinition
): TaskCadence | undefined {
  const type = definition.taskType?.trim().toLowerCase()
  if (type && (TASK_CADENCES as readonly string[]).includes(type)) {
    return type as TaskCadence
  }
  if (definition.isDaily) return "daily"
  if (definition.isWeekly) return "weekly"
  if (definition.isMonthly) return "monthly"
  if (definition.cronExpression)
    return cadenceFromCron(definition.cronExpression)
  return undefined
}

/** Reads the cadence off an expression's day fields. */
function cadenceFromCron(expression: string): TaskCadence {
  const cron = parseCron(expression)
  // One day of one month is a yearly schedule; one day of every month is
  // monthly; a named weekday is weekly; anything else is a daily task that
  // happens to be picky about its hour.
  if (cron.dayOfMonth.size === 1 && cron.month.size === 1) return "yearly"
  if (cron.dayOfMonth.size === 1) return "monthly"
  if (cron.dayOfWeek.size !== 7) return "weekly"
  return "daily"
}

/** The calendar date a moment falls on, in a timezone. */
function calendarDate(instant: Date, timeZone: string): CalendarDate {
  const parts = zonedParts(instant, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month
  return a.day - b.day
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  // Arithmetic on the calendar date, not on an instant: a day is a label here,
  // so it must not shift when a zone's offset changes.
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days, 12)
  )
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** A calendar date's weekday. The zone cannot change which day a date is. */
function dayOfWeek(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12)).getUTCDay()
}

/**
 * The Monday on or before a date, which is where a week starts.
 *
 * A week runs Monday to Sunday, so the offset is measured from Monday rather
 * than from Sunday: `getUTCDay` calls Sunday zero, and subtracting that
 * directly would put every Monday at the end of the week before it.
 */
function startOfWeek(date: CalendarDate): CalendarDate {
  return addDays(date, -((dayOfWeek(date) + 6) % 7))
}

function pad(value: number): string {
  return value.toString().padStart(2, "0")
}

/** The period a calendar date belongs to. */
export function periodKeyOf(cadence: TaskCadence, date: CalendarDate): string {
  switch (cadence) {
    case "daily":
      return `${date.year}-${pad(date.month)}-${pad(date.day)}`
    case "weekly":
      return periodKeyOf("daily", startOfWeek(date))
    case "monthly":
      return `${date.year}-${pad(date.month)}`
    case "yearly":
      return `${date.year}`
  }
}

/** The first day of the period a key names. */
function firstDateOfPeriod(cadence: TaskCadence, key: string): CalendarDate {
  const [year, month, day] = key.split("-").map(Number)
  switch (cadence) {
    case "daily":
      return { year: year!, month: month!, day: day! }
    case "weekly":
      return { year: year!, month: month!, day: day! }
    case "monthly":
      return { year: year!, month: month!, day: 1 }
    case "yearly":
      return { year: year!, month: 1, day: 1 }
  }
}

/** The key of the period `offset` periods away, `offset` counting forwards. */
export function shiftPeriod(
  cadence: TaskCadence,
  key: string,
  offset: number
): string {
  const first = firstDateOfPeriod(cadence, key)
  switch (cadence) {
    case "daily":
      return periodKeyOf("daily", addDays(first, offset))
    case "weekly":
      return periodKeyOf("weekly", addDays(first, offset * 7))
    case "monthly": {
      // A shift measured in months is anchored on the 1st, so a February that
      // has fewer days than the month it came from cannot overflow.
      const shifted = new Date(
        Date.UTC(first.year, first.month - 1 + offset, 1, 12)
      )
      return periodKeyOf("monthly", {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: 1,
      })
    }
    case "yearly":
      return periodKeyOf("yearly", {
        year: first.year + offset,
        month: 1,
        day: 1,
      })
  }
}

/**
 * The offset between a timezone and UTC, measured rather than assumed.
 *
 * The zone is read from the runtime's own tz database, so the answer stays
 * right if the schedule timezone is ever changed to one that keeps a different
 * offset on different dates.
 */
/** The instant a period opened, in UTC. */
export function periodStart(
  cadence: TaskCadence,
  key: string,
  timeZone = SCHEDULE_TIMEZONE
): Date {
  return instantOfCivil(firstDateOfPeriod(cadence, key), 0, timeZone)
}

/** Minutes since local midnight. */
function minutesOfDay(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone)
  return parts.hour * 60 + parts.minute
}

/**
 * Whether a date is one the expression fires on.
 *
 * Day-of-month and day-of-week follow cron's OR rule, exactly as
 * `matchesCron` does, so a schedule means the same thing here as it does
 * everywhere else.
 */
function isDueDate(cron: CronFields, date: CalendarDate): boolean {
  if (!cron.month.has(date.month)) return false

  const dayOfMonthRestricted = cron.dayOfMonth.size !== 31
  const dayOfWeekRestricted = cron.dayOfWeek.size !== 7
  const dayOfMonthMatches = cron.dayOfMonth.has(date.day)
  const dayOfWeekMatches = cron.dayOfWeek.has(dayOfWeek(date))

  if (dayOfMonthRestricted && dayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches
  }
  if (dayOfMonthRestricted) return dayOfMonthMatches
  if (dayOfWeekRestricted) return dayOfWeekMatches
  return true
}

/**
 * The latest time of day the expression names, at or before `cutoff`.
 *
 * Undefined when the cutoff has already passed every time it names, which is
 * how "the slot for today has not arrived yet" is expressed.
 */
function latestMinutesOfDay(
  cron: CronFields,
  cutoff?: number
): number | undefined {
  let latest: number | undefined
  for (const hour of cron.hour) {
    for (const minute of cron.minute) {
      const value = hour * 60 + minute
      if (cutoff !== undefined && value > cutoff) continue
      if (latest === undefined || value > latest) latest = value
    }
  }
  return latest
}

/**
 * Whether the period's due instant has already passed.
 *
 * False for a period whose slot is still ahead of the clock: that is what stops
 * a 04:00 task from being run by the 02:00 wake-up for a day that has not
 * reached 04:00 yet, and what stops a Monday task from running on a Monday
 * wake-up that fires before its hour.
 *
 * True for a period that is entirely in the past and holds a due instant, which
 * is what makes a missed day outstanding work rather than a day quietly
 * skipped.
 */
function periodIsOpen(
  cadence: TaskCadence,
  key: string,
  cron: CronFields,
  now: Date,
  timeZone: string
): boolean {
  const start = periodStart(cadence, key, timeZone)
  if (start.getTime() > now.getTime()) return false

  const today = calendarDate(now, timeZone)
  let date = calendarDate(start, timeZone)

  for (; compareDates(date, today) <= 0; date = addDays(date, 1)) {
    if (!isDueDate(cron, date)) continue
    // A whole past day inside the period is enough on its own; only today has
    // to be compared against the clock.
    if (compareDates(date, today) < 0) return true
    return latestMinutesOfDay(cron, minutesOfDay(now, timeZone)) !== undefined
  }

  return false
}

/** How much work a period has already had. */
export interface PeriodState {
  /** A run inside the period completed. */
  completed: boolean
  /** Runs the period has used, failures included. */
  attempts: number
}

export type PeriodSelection =
  | { kind: "due"; target: PeriodTarget }
  | { kind: "exhausted"; target: PeriodTarget }
  | { kind: "done" }

/**
 * Which period a tick should run, oldest first.
 *
 * `stateOf` is a function rather than a map so a caller can stop asking as
 * soon as it has an answer: most ticks find the first period already complete
 * and never look at the second, and a database round trip per period per task
 * is not worth paying for a tick that has nothing to do. It may answer with a
 * promise, which is what lets it read the state from the database.
 *
 * A period nobody could finish is reported as `exhausted` rather than skipped
 * silently, because the two mean opposite things to whoever reads a run
 * summary: nothing is left to do, versus a period that failed. It is also what
 * stops a task that keeps failing from being retried on every wake-up forever —
 * the cap is per period, so the next period starts with a full budget.
 */
export async function selectPeriod(
  targets: readonly PeriodTarget[],
  stateOf: (target: PeriodTarget) => PeriodState | Promise<PeriodState>
): Promise<PeriodSelection> {
  let exhausted: PeriodTarget | undefined

  for (const target of targets) {
    const state = await stateOf(target)

    if (state.completed) continue
    if (state.attempts >= MAX_ATTEMPTS_PER_PERIOD) {
      exhausted ??= target
      continue
    }

    return { kind: "due", target }
  }

  return exhausted ? { kind: "exhausted", target: exhausted } : { kind: "done" }
}

/** The earliest time of day the expression names. */
function earliestMinutesOfDay(cron: CronFields): number {
  let earliest = Number.POSITIVE_INFINITY
  for (const hour of cron.hour) {
    for (const minute of cron.minute) {
      earliest = Math.min(earliest, hour * 60 + minute)
    }
  }
  return earliest
}

/**
 * The first instant of the expression's own day that is still ahead of `after`.
 *
 * Compared as instants rather than as minutes, so a request made at 02:00:30 is
 * not offered the 02:00 that has already started.
 */
function firstMinutesAhead(
  cron: CronFields,
  after: Date,
  timeZone: string,
  inclusive: boolean
): number | undefined {
  const date = calendarDate(after, timeZone)
  const local = zonedParts(after, timeZone)
  const floor = local.hour * 60 + local.minute

  const minutes: number[] = []
  for (const hour of cron.hour) {
    for (const minute of cron.minute) minutes.push(hour * 60 + minute)
  }
  minutes.sort((a, b) => a - b)

  for (const value of minutes) {
    if (value < floor) continue
    const instant = instantOfCivil(date, value, timeZone).getTime()
    if (
      instant > after.getTime() ||
      (inclusive && instant === after.getTime())
    ) {
      return value
    }
  }

  return undefined
}

/**
 * The first instant an expression fires at, after `after`.
 *
 * Walks forward one date at a time over pure calendar arithmetic, so the cost
 * is the distance to the next match rather than the length of the schedule: a
 * daily task answers on its own day, a yearly one a few hundred dates later.
 * Undefined when nothing matches inside the horizon, which for a five-field
 * expression every day is never.
 */
export function nextDueInstant(
  expression: string,
  after: Date,
  options: { timeZone?: string; inclusive?: boolean; horizonDays?: number } = {}
): Date | undefined {
  const cron = parseCron(expression)
  const timeZone = options.timeZone ?? SCHEDULE_TIMEZONE
  let date = calendarDate(after, timeZone)

  for (let day = 0; day <= (options.horizonDays ?? 400); day += 1) {
    if (isDueDate(cron, date)) {
      const minutes =
        day === 0
          ? firstMinutesAhead(cron, after, timeZone, options.inclusive === true)
          : earliestMinutesOfDay(cron)

      if (minutes !== undefined)
        return instantOfCivil(date, minutes, timeZone)
    }
    date = addDays(date, 1)
  }

  return undefined
}

/**
 * When a task next runs, as a real instant.
 *
 * Two answers, and which one is honest depends on the history. If a period is
 * open and unfinished at the next wake-up, that wake-up runs it and this is the
 * moment. If everything is caught up, the next run is the wake-up at or after
 * the moment the following period opens — tomorrow morning for a daily task,
 * next January for the yearly one.
 *
 * Answered in wake-ups rather than in the task's own expression, because the
 * expression says when the work is *due* and this is a question about when
 * something will happen. An expression-only answer would promise 07:00 for a
 * task that runs at 02:00 the next morning.
 */
export async function nextRunAt(
  definition: ScheduleDefinition,
  stateOf: (target: PeriodTarget) => PeriodState | Promise<PeriodState>,
  now: Date,
  options: { wakeUpSchedule?: string; timeZone?: string } = {}
): Promise<Date | undefined> {
  // A definition with no cadence is never offered a period, so it never runs
  // and has no next run. Answering with the next wake-up would put a time on a
  // task the scheduler will not start.
  if (!cadenceOf(definition)) return undefined

  const timeZone = options.timeZone ?? SCHEDULE_TIMEZONE
  const wakeUpSchedule = options.wakeUpSchedule ?? VERCEL_CRON_SCHEDULE

  const nextWakeUp = (from: Date) =>
    nextDueInstant(wakeUpSchedule, from, {
      timeZone: "UTC",
      inclusive: true,
    })

  const first = nextWakeUp(now)
  if (!first) return undefined

  // `stateOf` is asked about periods as they stand at the wake-up rather than
  // now, because that is the moment the decision is made at. A period that
  // opens between now and the wake-up is not missed by looking early: nothing
  // runs except at a wake-up.
  const selection = await selectPeriod(
    periodTargets(definition, first, timeZone),
    stateOf
  )

  if (selection.kind === "due") return first

  // Caught up. The next run belongs to the period that opens after the wake-up
  // just went by, so the answer is the first wake-up at or after that moment.
  if (!definition.cronExpression) return first

  const nextOpening = nextDueInstant(definition.cronExpression, first, {
    timeZone,
  })
  return nextOpening ? nextWakeUp(nextOpening) : undefined
}

/**
 * The periods a tick should consider, oldest first.
 *
 * Both the current period and the one before it, when each is open. The one
 * before is what turns a missed day into work to do: a task whose Monday report
 * never ran is offered it again, and the caller only accepts it if that period
 * has no successful run.
 *
 * At most two, deliberately. A backlog deeper than one period is not replayed:
 * a weekly build run three weeks late would compute the wrong week, so the
 * outstanding period is closed and the current one takes over.
 *
 * Empty when nothing is due — a definition with no cadence, or one whose
 * expression names no date this task is on. An unparseable expression throws,
 * as it did in `matchesCron`, rather than silently running everything.
 */
export function periodTargets(
  definition: ScheduleDefinition,
  now: Date,
  timeZone = SCHEDULE_TIMEZONE
): PeriodTarget[] {
  const cadence = cadenceOf(definition)
  if (!cadence) return []

  const currentKey = periodKeyOf(cadence, calendarDate(now, timeZone))

  if (!definition.cronExpression) {
    // No expression of its own: the cadence is the whole schedule, which is
    // the behaviour the source's daily-only default had.
    return [
      {
        cadence,
        key: currentKey,
        start: periodStart(cadence, currentKey, timeZone),
      },
    ]
  }

  const cron = parseCron(definition.cronExpression)
  const targets: PeriodTarget[] = []
  const previousKey = shiftPeriod(cadence, currentKey, -1)

  if (periodIsOpen(cadence, previousKey, cron, now, timeZone)) {
    targets.push({
      cadence,
      key: previousKey,
      start: periodStart(cadence, previousKey, timeZone),
    })
  }

  if (periodIsOpen(cadence, currentKey, cron, now, timeZone)) {
    targets.push({
      cadence,
      key: currentKey,
      start: periodStart(cadence, currentKey, timeZone),
    })
  }

  return targets
}
