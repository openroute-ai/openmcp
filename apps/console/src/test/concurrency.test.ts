/**
 * Unit tests for the bounded fan-out the ingest path depends on.
 *
 * Order and ceiling are both load-bearing: callers store results against the
 * skills they came from, and the ceiling is what makes going faster safe. These
 * pin both, plus the failure behaviour callers already rely on.
 */
import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "@/lib/concurrency"

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("mapWithConcurrency", () => {
  it("returns results in input order, not completion order", async () => {
    const result = await mapWithConcurrency(
      [30, 1, 15],
      3,
      async (delay, index) => {
        await tick(delay)
        return index
      }
    )

    expect(result).toEqual([0, 1, 2])
  })

  it("never runs more tasks at once than the limit allows", async () => {
    let inFlight = 0
    let peak = 0

    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await tick(5)
        inFlight -= 1
      }
    )

    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it("runs every item even when there are fewer items than the limit", async () => {
    const seen: number[] = []

    await mapWithConcurrency([1, 2], 8, async (item) => {
      seen.push(item)
    })

    expect(seen.sort()).toEqual([1, 2])
  })

  it("returns an empty array for no items", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })

  it("rejects on the first failure rather than collecting partial results", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("rate limited")
        return item
      })
    ).rejects.toThrow("rate limited")
  })

  it("refuses a limit that would let everything through unbounded", async () => {
    await expect(mapWithConcurrency([1], 0, async (i) => i)).rejects.toThrow(
      RangeError
    )
  })
})
