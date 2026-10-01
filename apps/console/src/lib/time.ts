/**
 * The one timezone this app means when it says "what time is it".
 *
 * Every schedule, every published period and every date on screen is expressed
 * in Asia/Shanghai. Vercel runs on UTC, an operator's laptop is on whatever
 * zone they flew in on, and `new Date()` on a server is therefore the wrong
 * answer to every question this app asks about a calendar: at Beijing Monday
 * 00:30 the UTC date is still Sunday, so a "last complete week" default would
 * report the week before last for eight hours a day, and the month and year
 * would be wrong the same way at their own boundaries.
 *
 * The instant itself stays an instant. These helpers only answer "what does the
 * calendar look like where the team is", which is what a period, a due time or
 * a label needs.
 */

export const APP_TIMEZONE = "Asia/Shanghai"

export interface ZonedParts {
  year: number
  minute: number
  hour: number
  second: number
  day: number
  month: number
  dayOfWeek: number
}

/**
 * Formatter cache, keyed by timezone.
 *
 * `Intl.DateTimeFormat` instances are immutable and reusable, but constructing
 * one resolves locale data and costs roughly five times what formatting with an
 * existing one does. This app asks "what time is it" constantly — every
 * schedule, period, ranking window and label goes through `zonedParts` — and
 * the answer only depends on the instant and the zone, so building a fresh
 * formatter per call was pure repeated work. One test file that walks a
 * schedule minute by minute constructed twenty thousand of them.
 *
 * The set of zones in use is the handful `APP_TIMEZONE` covers, so this stays
 * small; a caller looping over arbitrary zones would grow it, but none does.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>()

/** The cached formatter for a zone, built on first use. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached

  // en-US with an explicit zone is the reliable way to read local fields
  // without depending on the server's own locale or zone.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  formatterCache.set(timeZone, formatter)
  return formatter
}

/** Wall-clock fields for a moment in a timezone. */
export function zonedParts(
  now: Date,
  timeZone: string = APP_TIMEZONE
): ZonedParts {
  const formatter = formatterFor(timeZone)

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") parts[part.type] = part.value
  }

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  const weekday = parts.weekday

  return {
    // Intl renders midnight as "24" in some locales under hour12: false, so
    // it is reduced back into 0-23.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    year: Number(parts.year),
    day: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: weekday === undefined ? 0 : (weekdays[weekday] ?? 0),
  }
}

/**
 * The same instant, rewritten so its UTC fields read as the timezone's
 * wall clock.
 *
 * This is the bridge between `Intl`, which knows how to look at a moment in a
 * zone, and the date helpers that reason in UTC fields — the ISO week
 * arithmetic, the month arithmetic. Those are pure calendar functions and stay
 * that way: hand them a date whose UTC fields are Beijing's, and the week
 * number they return is Beijing's.
 */
export function zonedCivilDate(
  now: Date,
  timeZone: string = APP_TIMEZONE
): Date {
  const parts = zonedParts(now, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  // The wall clock minus the instant is the zone's offset at that moment. Adding
  // it back lands on a date that reads the right fields in UTC. Milliseconds are
  // dropped on purpose: `Intl` does not report them, and a shift that invented
  // one would make a period boundary off by a millisecond.
  const millis = now.getTime() - (now.getTime() % 1000)
  return new Date(now.getTime() + (asUtc - millis))
}

/** The calendar year where the team is, which is not the UTC year eight hours out. */
export function zonedYear(
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): number {
  return zonedParts(now, timeZone).year
}

/**
 * The calendar month where the team is, as 1-12.
 *
 * Bucketed the same way `zonedCivilDate` buckets a date, so a caller asking
 * "which month is this instant in" and a caller asking "which month is that
 * date in" cannot disagree.
 */
export function zonedMonth(
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): { year: number; month: number } {
  const parts = zonedParts(now, timeZone)
  return { year: parts.year, month: parts.month }
}

/** A calendar date with no time and no zone, as a calendar in a zone reads it. */
export interface CivilDate {
  year: number
  month: number
  day: number
}

/**
 * The offset between a timezone and UTC at a given instant, measured rather
 * than assumed.
 *
 * The zone is read from the runtime's own tz database, so the answer stays
 * right if the timezone is ever changed to one that keeps a different offset on
 * different dates.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The instant a wall-clock time in a timezone refers to.
 *
 * Built from local midnight plus the offset, then corrected once against the
 * offset measured at the result: the two agree except where a zone changes
 * offset in between, and a second pass settles that.
 */
export function instantOfCivil(
  civil: CivilDate,
  minutesOfDay = 0,
  timeZone: string = APP_TIMEZONE
): Date {
  const guess = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day, 0, 0, 0) +
      minutesOfDay * 60_000
  )

  let instant = guess
  for (let pass = 0; pass < 2; pass += 1) {
    const corrected = new Date(
      guess.getTime() - zoneOffsetMs(instant, timeZone)
    )
    if (corrected.getTime() === instant.getTime()) break
    instant = corrected
  }
  return instant
}

/** The calendar date a moment falls on in a timezone. */
export function civilOf(
  instant: Date,
  timeZone: string = APP_TIMEZONE
): CivilDate {
  const parts = zonedParts(instant, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}
