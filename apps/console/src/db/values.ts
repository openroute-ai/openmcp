import type { DriverValueDecoder } from "drizzle-orm"

/**
 * Decoders for values that reach the app as raw driver output.
 *
 * drizzle hands the `pg` node-postgres driver a type parser that returns
 * timestamps, dates and intervals **as the text Postgres sent**, and converts
 * them itself afterwards — but only for the fields it recognises, which are the
 * columns declared in the schema. A bare `sql` fragment has no column behind
 * it, so nothing converts it: `min(some_timestamp_column)` arrives as the string
 * `"2026-10-01 00:13:20.221632"` however it is annotated.
 *
 * `sql<Date | null>` is a claim about the type, not a conversion, so the value
 * crossed the wire as a string and stayed one. That is invisible until something
 * formats it: `Intl.DateTimeFormat.prototype.format` coerces a string with
 * `ToNumber`, which is `NaN`, so a perfectly good timestamp rendered as
 * `RangeError: Invalid time value` — and a truthiness check passes it straight
 * through, because a string is truthy where `null` is not.
 *
 * `.mapWith(…)` is where the conversion belongs: it is the hook drizzle applies
 * to the driver value before the row is built, so the annotated type becomes
 * true. The driver value is typed as the shapes a timestamp can arrive in rather
 * than as `unknown`, so decoding needs no cast — including `null`, which is what
 * an aggregate over no rows returns.
 */
export const nullableTimestamp: DriverValueDecoder<
  Date | null,
  string | number | Date | null
> = {
  mapFromDriverValue: (value) => {
    if (value == null) return null
    return value instanceof Date ? value : new Date(value)
  },
}
