import { describe, expect, it } from "vitest"
import {
  aggregateMeta,
  processItems,
  type ItemResult,
} from "@/lib/tasks/iterate"
import { createBufferingLogger, type TaskLogger } from "@/lib/tasks/runner"

function silentLogger(): TaskLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

describe("aggregateMeta", () => {
  it("sums numbers and counts booleans as one", () => {
    const totals = aggregateMeta([
      { meta: { processed: 1, updated: true }, data: null },
      { meta: { processed: 1, updated: false }, data: null },
    ])

    expect(totals).toEqual({ processed: 2, updated: 1 })
  })

  it("treats undefined and zero as no contribution", () => {
    const totals = aggregateMeta([
      { meta: { skipped: undefined, archived: false }, data: null },
    ])

    expect(totals).toEqual({ skipped: 0, archived: 0 })
  })

  it("is empty for no results", () => {
    expect(aggregateMeta([])).toEqual({})
  })
})

describe("processItems", () => {
  const base = { logger: silentLogger(), label: "item" }

  it("returns every item's data in input order", async () => {
    const result = await processItems(
      ["a", "b", "c"],
      async (item) => ({ meta: { processed: 1 }, data: item.toUpperCase() }),
      base
    )

    expect(result.data).toEqual(["A", "B", "C"])
    expect(result.meta).toEqual({ processed: 3 })
    expect(result.errors).toEqual([])
  })

  it("isolates a throw and keeps going", async () => {
    const result = await processItems(
      [1, 2, 3],
      async (item) => {
        if (item === 2) throw new Error("bad item")
        return { meta: { processed: 1 }, data: item }
      },
      base
    )

    expect(result.data).toEqual([1, 3])
    expect(result.meta).toEqual({ processed: 2, error: 1 })
    expect(result.errors.map((error) => error.message)).toEqual(["bad item"])
  })

  it("isolates a non-Error throw", async () => {
    const result = await processItems(
      [1],
      async () => {
        throw "plain string"
      },
      base
    )

    expect(result.errors[0]?.message).toBe("plain string")
    expect(result.meta).toEqual({ error: 1 })
  })

  it("keeps a null data out of the collected output", async () => {
    const result = await processItems(
      [1, 2],
      async (item) =>
        item === 1
          ? { meta: { skipped: 1 }, data: null }
          : { meta: { skipped: 0 }, data: item },
      base
    )

    expect(result.data).toEqual([2])
  })

  it("never runs more than the configured concurrency at once", async () => {
    let active = 0
    let peak = 0

    await processItems(
      Array.from({ length: 12 }, (_, index) => index),
      async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { meta: {}, data: null }
      },
      { ...base, concurrency: 3 }
    )

    expect(peak).toBeLessThanOrEqual(3)
  })

  it("runs every item exactly once", async () => {
    const seen: number[] = []

    await processItems(
      [1, 2, 3, 4, 5],
      async (item) => {
        seen.push(item)
        return { meta: {}, data: null }
      },
      { ...base, concurrency: 4 }
    )

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it("spaces starts by the throttle interval across the whole loop", async () => {
    const starts: number[] = []

    await processItems(
      Array.from({ length: 3 }, (_, index) => index),
      async () => {
        starts.push(Date.now())
        return { meta: {}, data: null }
      },
      { ...base, concurrency: 3, throttleIntervalMs: 25 }
    )

    // Concurrency is 3, so a per-worker interval would let all three start at
    // once. The gate is shared, so consecutive starts are spaced.
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20)
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(20)
  })

  it("handles an empty list", async () => {
    const result = await processItems(
      [],
      async () => ({ meta: {}, data: null }),
      base
    )

    expect(result).toMatchObject({ data: [], errors: [] })
    expect(result.meta).toEqual({})
  })

  it("logs the failure to the task log", async () => {
    const logger = createBufferingLogger()
    await processItems(
      [1],
      async () => {
        throw new Error("logged failure")
      },
      { logger, label: "widget" }
    )

    expect(logger.text()).toContain("error processing widget #1")
  })
})

describe("ItemResult", () => {
  it("is satisfied by a plain result", () => {
    const result: ItemResult<string> = { meta: { ok: true }, data: "x" }
    expect(result.data).toBe("x")
  })
})
