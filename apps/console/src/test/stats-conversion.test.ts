import { describe, expect, it } from "vitest"
import { toPeriodStats, type CounterLevels } from "@/lib/github/service/stats"

/**
 * A stored row, with only the columns named.
 *
 * Readers are handed whole Drizzle rows, so the fixtures here are full rows
 * where the test is about conversion and partial ones where it is about a single
 * column. `NULL` is the interesting value throughout: an unmeasured counter must
 * survive as `null` rather than becoming 0.
 */
function row(period: string, columns: Record<string, number | null>) {
  return { period: new Date(period), ...columns }
}

describe("toPeriodStats", () => {
  it("reads the level and the change out of the columns they are stored in", () => {
    const stats = toPeriodStats(
      [row("2026-03-01T00:00:00Z", { totalStars: 400, deltaStars: 220, deltaNewStars: 260 })],
      "stars"
    )

    expect(stats).toEqual([
      {
        period: new Date("2026-03-01T00:00:00Z"),
        total: 400,
        delta: 220,
        newStars: 260,
      },
    ])
  })

  it("keeps a level and a change that disagree apart", () => {
    // The regression this guards: a caller that writes one number into both
    // columns produces a chart where every bar is the height of the level.
    const stats = toPeriodStats(
      [row("2026-03-01T00:00:00Z", { totalStars: 400, deltaStars: 12, deltaNewStars: 40 })],
      "stars"
    )

    expect(stats[0]?.total).toBe(400)
    expect(stats[0]?.delta).toBe(12)
    expect(stats[0]?.newStars).toBe(40)
  })

  it("leaves the first period without a delta rather than reporting the level as growth", () => {
    const stats = toPeriodStats(
      [
        row("2026-01-01T00:00:00Z", {
          totalStars: 100,
          deltaStars: null,
          deltaNewStars: 100,
        }),
      ],
      "stars"
    )

    expect(stats[0]?.delta).toBeNull()
    expect(stats[0]?.total).toBe(100)
  })

  it("survives a NULL level as null, not zero", () => {
    const stats = toPeriodStats(
      [row("2026-01-01T00:00:00Z", { totalContributors: null, deltaContributors: null })],
      "contributors"
    )

    expect(stats[0]?.total).toBeNull()
    expect(stats[0]?.delta).toBeNull()
    // A reader cannot tell "nobody contributed" from "nobody measured it", and
    // that distinction is the whole reason the column is nullable.
    expect(stats[0]?.total).not.toBe(0)
  })

  it("reports a real zero as zero", () => {
    const stats = toPeriodStats(
      [row("2026-01-01T00:00:00Z", { totalStars: 0, deltaStars: 0, deltaNewStars: 0 })],
      "stars"
    )

    expect(stats[0]).toMatchObject({ total: 0, delta: 0, newStars: 0 })
  })

  it("reads a counter other than stars without touching the star columns", () => {
    const stats = toPeriodStats(
      [
        row("2026-01-01T00:00:00Z", {
          totalStars: 400,
          deltaStars: 20,
          totalDownloads: 50_000,
          deltaDownloads: 5_000,
        }),
      ],
      "downloads"
    )

    expect(stats[0]?.total).toBe(50_000)
    expect(stats[0]?.delta).toBe(5_000)
    expect(stats[0]?.newStars).toBeNull()
  })

  it("orders the periods oldest first whatever order they arrive in", () => {
    const stats = toPeriodStats(
      [
        row("2026-03-01T00:00:00Z", { totalStars: 400 }),
        row("2026-01-01T00:00:00Z", { totalStars: 100 }),
        row("2026-02-01T00:00:00Z", { totalStars: 180 }),
      ],
      "stars"
    )

    expect(stats.map((entry) => entry.total)).toEqual([100, 180, 400])
  })

  it("returns nothing for an empty history", () => {
    expect(toPeriodStats([], "stars")).toEqual([])
  })
})

describe("counter levels", () => {
  it("accepts a level per counter that owns one", () => {
    // `newStars` has no level of its own — the level *is* `stars` — so
    // `CounterLevels` cannot express one for it, and a writer that wanted to
    // record `total_new_stars` would not compile. This test fails to typecheck
    // if that exclusion is ever dropped, which is the point of it.
    const levels: CounterLevels = {
      stars: 400,
      forks: 40,
      openIssues: 12,
      commits: 900,
    }

    expect(levels).toEqual({
      stars: 400,
      forks: 40,
      openIssues: 12,
      commits: 900,
    })
  })
})
