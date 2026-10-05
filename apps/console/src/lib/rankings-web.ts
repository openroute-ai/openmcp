/**
 * Period resolution for the ranking reads.
 *
 * The public endpoints and the dashboard router both answer "give me the
 * current weekly / monthly / yearly ranking", and both default to the same
 * "last complete period" the build task uses, so an unparameterised request
 * and a freshly run task agree. Passing a period explicitly overrides that,
 * which is how a consumer fetches an older one.
 *
 * An invalid period is an error the caller reports rather than a silently
 * different result: silently ranking a different week than was asked for is
 * how a dashboard ends up showing stale data as if it were live.
 */

import {
  lastCompletePeriod,
  type YearMonth,
  type YearWeek,
} from "@/lib/github/snapshot-dates"
import { zonedYear } from "@/lib/time"

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * The year the Rising Stars report defaults to: the one that just ended.
 *
 * Beijing's calendar year, so a run at Beijing 00:30 on 1 January reports 2025
 * rather than 2024 — the year that just ended there is still the previous one
 * in UTC.
 */
export function defaultYear(now: Date = new Date()): number {
  return zonedYear(now) - 1
}

function isYear(value: number): boolean {
  return /^\d{4}$/.test(String(value)) && value >= 2000 && value <= 9999
}

function isWeek(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 53
}

function isMonth(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 12
}

function parseYear(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^\d{4}$/.test(value)) return undefined
  const year = Number(value)
  return isYear(year) ? year : undefined
}

function parseWeek(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^\d{1,2}$/.test(value)) return undefined
  const week = Number(value)
  return isWeek(week) ? week : undefined
}

function parseMonth(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^\d{1,2}$/.test(value)) return undefined
  const month = Number(value)
  return isMonth(month) ? month : undefined
}

/** Resolves already-validated numbers to a week. */
export function resolveWeekInput(
  input: { year?: number; week?: number },
  now: Date = new Date()
): Result<YearWeek> {
  if (input.week !== undefined && !isWeek(input.week)) {
    return { ok: false, error: "week must be an integer between 1 and 53" }
  }
  if (input.year !== undefined && !isYear(input.year)) {
    return { ok: false, error: "year must be four digits" }
  }
  if (input.week !== undefined) {
    return {
      ok: true,
      value: { year: input.year ?? zonedYear(now), week: input.week },
    }
  }
  return { ok: true, value: lastCompletePeriod("week", now) }
}

/** Resolves already-validated numbers to a month. */
export function resolveMonthInput(
  input: { year?: number; month?: number },
  now: Date = new Date()
): Result<YearMonth> {
  if (input.month !== undefined && !isMonth(input.month)) {
    return { ok: false, error: "month must be an integer between 1 and 12" }
  }
  if (input.year !== undefined && !isYear(input.year)) {
    return { ok: false, error: "year must be four digits" }
  }
  if (input.month !== undefined) {
    return {
      ok: true,
      value: { year: input.year ?? zonedYear(now), month: input.month },
    }
  }
  return { ok: true, value: lastCompletePeriod("month", now) }
}

/** Resolves a possibly-present year, defaulting to the last complete one. */
export function resolveYearInput(
  input: { year?: number },
  now: Date = new Date()
): Result<number> {
  if (input.year !== undefined && !isYear(input.year)) {
    return { ok: false, error: "year must be four digits" }
  }
  return { ok: true, value: input.year ?? defaultYear(now) }
}

/** Parses the `week`/`year` query string, then defers to the numeric resolver. */
export function resolveWeek(
  params: URLSearchParams,
  now: Date = new Date()
): Result<YearWeek> {
  const week = parseWeek(params.get("week"))
  if (params.has("week") && week === undefined) {
    return { ok: false, error: "week must be an integer between 1 and 53" }
  }
  const year = parseYear(params.get("year"))
  if (params.has("year") && year === undefined) {
    return { ok: false, error: "year must be four digits" }
  }
  return resolveWeekInput({ year, week }, now)
}

/** Parses the `month`/`year` query string, then defers to the numeric resolver. */
export function resolveMonth(
  params: URLSearchParams,
  now: Date = new Date()
): Result<YearMonth> {
  const month = parseMonth(params.get("month"))
  if (params.has("month") && month === undefined) {
    return { ok: false, error: "month must be an integer between 1 and 12" }
  }
  const year = parseYear(params.get("year"))
  if (params.has("year") && year === undefined) {
    return { ok: false, error: "year must be four digits" }
  }
  return resolveMonthInput({ year, month }, now)
}

/** Parses `rising-stars.json`'s query string. */
export function resolveYear(
  params: URLSearchParams,
  now: Date = new Date()
): Result<number> {
  const year = parseYear(params.get("year"))
  if (params.has("year") && year === undefined) {
    return { ok: false, error: "year must be four digits" }
  }
  return resolveYearInput({ year }, now)
}
