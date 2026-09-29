import { describe, expect, it } from "vitest"
import {
  bundleErrorFor,
  downloadRangeDates,
  groupDownloadsByMonth,
  needsBundleUpdate,
} from "@/lib/github/service/package"

describe("needsBundleUpdate", () => {
  it("measures a package that has no bundle yet", () => {
    expect(needsBundleUpdate("1.0.0", undefined)).toBe(true)
  })

  it("skips a package already measured at the same version", () => {
    expect(
      needsBundleUpdate("1.0.0", { version: "1.0.0", errorMessage: null })
    ).toBe(false)
  })

  it("measures a package whose version has moved on", () => {
    expect(
      needsBundleUpdate("2.0.0", { version: "1.0.0", errorMessage: null })
    ).toBe(true)
  })

  it("retries a package whose previous measurement failed", () => {
    // A stored error means the last attempt did not produce a size, whatever
    // the version says. The reason may since have been fixed.
    expect(
      needsBundleUpdate("1.0.0", { version: "1.0.0", errorMessage: "timeout" })
    ).toBe(true)
  })

  it("measures when the package version is unknown", () => {
    expect(
      needsBundleUpdate(null, { version: "1.0.0", errorMessage: null })
    ).toBe(true)
  })
})

describe("bundleErrorFor", () => {
  it("clears the error on a successful measurement", () => {
    expect(bundleErrorFor("updated")).toBeNull()
  })

  it("stores the outcome as the error when it failed", () => {
    expect(bundleErrorFor("timeout")).toBe("timeout")
    expect(bundleErrorFor("not-browser-bundle")).toBe("not-browser-bundle")
  })
})

describe("groupDownloadsByMonth", () => {
  it("sums a daily series into months", () => {
    const result = groupDownloadsByMonth([
      { day: "2026-01-01", downloads: 10 },
      { day: "2026-01-15", downloads: 5 },
      { day: "2026-02-01", downloads: 7 },
    ])

    expect(result).toEqual([
      { year: 2026, month: 1, downloads: 15 },
      { year: 2026, month: 2, downloads: 7 },
    ])
  })

  it("orders months chronologically rather than by first appearance", () => {
    const result = groupDownloadsByMonth([
      { day: "2026-03-01", downloads: 1 },
      { day: "2026-01-01", downloads: 1 },
      { day: "2026-02-01", downloads: 1 },
    ])

    expect(result.map((r) => r.month)).toEqual([1, 2, 3])
  })

  it("counts a zero-download day as part of the total", () => {
    const result = groupDownloadsByMonth([
      { day: "2026-01-01", downloads: 0 },
      { day: "2026-01-02", downloads: 4 },
    ])

    expect(result).toEqual([{ year: 2026, month: 1, downloads: 4 }])
  })

  it("skips a malformed day rather than inventing a bucket", () => {
    const result = groupDownloadsByMonth([
      { day: "2026-01-01", downloads: 4 },
      { day: "bad", downloads: 99 },
    ])

    expect(result).toEqual([{ year: 2026, month: 1, downloads: 4 }])
  })

  it("returns nothing for an empty series", () => {
    expect(groupDownloadsByMonth([])).toEqual([])
  })
})

describe("downloadRangeDates", () => {
  it("covers a full year ending on the last day of the previous month", () => {
    // Including the current partial month would report downloads collapsing
    // to a few days' worth every month.
    const { startDate, endDate } = downloadRangeDates(
      new Date("2026-03-15T00:00:00Z")
    )

    expect(startDate).toBe("2025-03-01")
    expect(endDate).toBe("2026-02-28")
  })

  it("handles a leap year's February end", () => {
    const { endDate } = downloadRangeDates(new Date("2028-03-01T00:00:00Z"))
    expect(endDate).toBe("2028-02-29")
  })

  it("handles January without needing the previous December", () => {
    const { startDate, endDate } = downloadRangeDates(
      new Date("2026-01-10T00:00:00Z")
    )

    expect(startDate).toBe("2025-01-01")
    expect(endDate).toBe("2025-12-31")
  })
})
