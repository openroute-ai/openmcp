import { useLocale, useNow, useTranslations } from "next-intl"

import type { Locale } from "@/lib/config/i18n"
import { APP_TIMEZONE } from "@/lib/time"

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
/**
 * Thresholds for choosing a unit, not lengths of a month or a year.
 *
 * These are deliberately the short side of each unit. An average year is 365.25
 * days, and using that made a run exactly a year old report as "12 months ago"
 * because 365 days falls just short of it. Choosing the unit on a threshold and
 * then rounding the amount keeps the common case reading as a year.
 */
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** Largest first: the first unit the gap reaches is the one reported. */
const RELATIVE_UNITS = [
  ["year", YEAR],
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
  ["second", SECOND],
] as const satisfies ReadonlyArray<
  readonly [Intl.RelativeTimeFormatUnit, number]
>

/**
 * The units this composes durations from.
 *
 * Named here rather than as `Intl.DurationUnit`, which the TypeScript lib does
 * not export; it only exists on `Intl.DurationFormat`, which is too new to use.
 */
type DurationUnitName = "day" | "hour" | "minute" | "second" | "millisecond"

/** Largest first, for composing a duration. */
const DURATION_UNITS = [
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
  ["second", SECOND],
  ["millisecond", 1],
] as const satisfies ReadonlyArray<readonly [DurationUnitName, number]>

/** How many units a duration shows before the rest is dropped. */
const DURATION_PARTS = 2

/**
 * Formatters, kept per locale.
 *
 * Constructing an `Intl` object builds a formatter inside the ICU library, and
 * a table formats a timestamp per row, so building one per call shows up in a
 * profile. The key space is the set of locales, so the cache cannot grow.
 */
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>()
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()
const unitFormats = new Map<string, Intl.NumberFormat>()
const listFormats = new Map<Locale, Intl.ListFormat>()

const relativeFormat = (locale: Locale) => {
  let format = relativeFormats.get(locale)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
    relativeFormats.set(locale, format)
  }
  return format
}

/** The fields a full timestamp shows, and the widths they are shown at. */
const DEFAULT_DATE_TIME_FIELDS = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions

const dateTimeFormat = (
  locale: Locale,
  timeZone: string,
  fields: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat => {
  // Keyed on the field set as well as the locale and zone: a caller asking for
  // a month name gets a different formatter from one asking for a full stamp,
  // and the two must not share a cache entry.
  const key = `${locale}|${timeZone}|${JSON.stringify(fields)}`
  let format = dateTimeFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone, ...fields })
    dateTimeFormats.set(key, format)
  }
  return format
}

const unitFormat = (locale: Locale, unit: DurationUnitName) => {
  const key = `${locale}:${unit}`
  let format = unitFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "narrow",
    })
    unitFormats.set(key, format)
  }
  return format
}

const listFormat = (locale: Locale) => {
  let format = listFormats.get(locale)
  if (!format) {
    format = new Intl.ListFormat(locale, { type: "unit" })
    listFormats.set(locale, format)
  }
  return format
}

export interface FormatContext {
  locale: Locale
  /** Stands in for a missing value, so an absent timestamp reads as absent. */
  empty: string
  /**
   * Pinned so a server render and a client render of the same row agree. Left
   * to `new Date()` the two can straddle a second boundary and the text
   * mismatches, which React reports as a hydration error.
   */
  now: Date
}

/**
 * How long ago, or how long until, in the reader's language.
 *
 * `numeric: "always"` because these read as measurements in a table: "1 day
 * ago" says what "yesterday" only says relative to whoever is reading.
 */
export function formatRelative(
  value: Date | null | undefined,
  { locale, empty, now }: FormatContext
): string {
  if (!value) return empty

  const gap = value.getTime() - now.getTime()
  const magnitude = Math.abs(gap)
  const sign = gap < 0 ? -1 : 1

  const [unit, size] =
    RELATIVE_UNITS.find(([, threshold]) => magnitude >= threshold) ??
    (["second", SECOND] as const)

  const amount = sign * Math.round(magnitude / size)

  return relativeFormat(locale).format(amount, unit)
}

/**
 * An absolute timestamp, in the reader's calendar and ordering.
 *
 * The old pattern was `MMM d, HH:mm`, which hardcodes an English month and a
 * month-first ordering; the options below are what each locale actually uses.
 *
 * `options` is honoured rather than dropped. A caller that names a timezone and
 * a narrower field set gets exactly that: the ranking month label asks for
 * `month: "long"` in `Asia/Shanghai`, and a formatter that ignored both would
 * render it from the *server's* zone — on Vercel that is UTC, eight hours
 * behind, so a period could be labelled with the wrong month. Beijing is the
 * default rather than the server's zone for the same reason.
 */
export function formatDateTime(
  value: Date | null | undefined,
  { locale, empty }: FormatContext,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!value) return empty

  const { timeZone = APP_TIMEZONE, ...fields } = options
  const resolved =
    Object.keys(fields).length > 0
      ? (fields as Intl.DateTimeFormatOptions)
      : DEFAULT_DATE_TIME_FIELDS

  return dateTimeFormat(locale, timeZone, resolved).format(value)
}

/**
 * A duration, in the reader's units.
 *
 * `Intl.DurationFormat` would do this in one call, but it is new enough that
 * an older browser has no constructor for it, so the parts are composed from
 * `Intl.NumberFormat`, which has carried unit style for years. `narrow` is
 * what keeps English reading "1h" rather than "1 hr".
 *
 * The parts are combined by `Intl.ListFormat` rather than by joining on a
 * space, because the separator is the language's decision: Chinese writes
 * "2小时30分钟" with nothing between the units, and a hardcoded space puts one
 * there.
 */
export function formatDuration(
  value: number | null | undefined,
  { locale, empty }: FormatContext
): string {
  if (value == null) return empty

  const magnitude = Math.abs(value)
  const parts: string[] = []
  let rest = Math.round(magnitude)

  for (const [unit, size] of DURATION_UNITS) {
    if (parts.length === DURATION_PARTS) break
    if (magnitude < size) continue

    const amount = Math.floor(rest / size)
    rest -= amount * size
    if (amount === 0) continue

    parts.push(unitFormat(locale, unit).format(amount))
  }

  // A zero-length duration has no largest unit to report, and an empty string
  // would leave the cell blank, which is what the em dash is for.
  if (parts.length === 0) return formatUnit(0, "millisecond", locale)

  return listFormat(locale).format(parts)
}

function formatUnit(
  amount: number,
  unit: DurationUnitName,
  locale: Locale
): string {
  return unitFormat(locale, unit).format(amount)
}

/**
 * The formatters bound to the active locale, for components.
 *
 * The empty string and "now" come from the request rather than from props, so
 * a component cannot accidentally format a timestamp in one locale and a
 * fallback in another.
 */
export function useFormats() {
  const locale: Locale = useLocale()
  const now = useNow()
  const empty = useTranslations("Common")("none")

  const context: FormatContext = { locale, empty, now }

  return {
    relative: (value: Date | null | undefined) =>
      formatRelative(value, context),
    /**
     * `options` is forwarded, so a caller that names a timezone or a narrower
     * field set gets it. Dropping it here is what made a pinned
     * `timeZone: APP_TIMEZONE` on a ranking label inert.
     */
    dateTime: (
      value: Date | null | undefined,
      options?: Intl.DateTimeFormatOptions
    ) => formatDateTime(value, context, options),
    duration: (value: number | null | undefined) =>
      formatDuration(value, context),
  }
}
