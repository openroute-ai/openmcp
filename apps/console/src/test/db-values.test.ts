/**
 * Tests for the decoder that stands between a raw SQL fragment and the formatters.
 *
 * The failure this prevents is not visible in the query: `min(created_at)` was
 * annotated as a `Date` and returned one of Postgres' timestamp strings, so the
 * type said otherwise and only the page that formatted the value could tell. A
 * test that formats the decoded value is the check the annotation could not be.
 */
import { describe, expect, it } from "vitest"

import { nullableTimestamp } from "@/db/values"

/** The exact shape `pg` hands back for a timestamp under drizzle's parser. */
const FROM_DRIVER = "2026-10-01 00:13:20.221632"

describe("nullableTimestamp", () => {
  it("parses the text the driver returns", () => {
    const parsed = nullableTimestamp.mapFromDriverValue(FROM_DRIVER)

    expect(parsed).toBeInstanceOf(Date)
    expect(Number.isNaN(parsed?.getTime() ?? NaN)).toBe(false)
  })

  it("keeps a value a driver already parsed", () => {
    const already = new Date("2026-10-01T00:13:20.221Z")

    expect(nullableTimestamp.mapFromDriverValue(already)).toBe(already)
  })

  it("reads a missing aggregate as no timestamp", () => {
    expect(nullableTimestamp.mapFromDriverValue(null)).toBeNull()
  })

  it("returns something Intl can format", () => {
    // `format` coerces its argument with `ToNumber`, so the undecoded string was
    // `NaN` — a valid timestamp rendered as `RangeError: Invalid time value`.
    const parsed = nullableTimestamp.mapFromDriverValue(FROM_DRIVER)

    expect(() =>
      new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai" }).format(
        parsed as Date
      )
    ).not.toThrow()
  })
})
