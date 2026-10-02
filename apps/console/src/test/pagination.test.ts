/**
 * Tests for the page arithmetic every paged list shares.
 *
 * Pure functions, so no database and no rendering: what is worth pinning down
 * here is the input handling, because a page number is the one piece of a list's
 * state that arrives from a URL rather than from the code that built the list.
 * Every case below is a URL a reader, a crawler or an agent can actually produce,
 * and the two that matter most are the ones that must never reach SQL: a
 * negative offset is a query error rather than an empty page, and an offset past
 * the end renders a page that claims to be page 40 of a three-page shelf.
 */
import { describe, expect, it } from "vitest"
import { clampPage, pageCount, pageWindow } from "@/lib/pagination"

describe("pageCount", () => {
  it("counts the pages a total fills, and never fewer than one", () => {
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(1, 20)).toBe(1)
    expect(pageCount(20, 20)).toBe(1)
    expect(pageCount(21, 20)).toBe(2)
    expect(pageCount(143, 20)).toBe(8)
  })
})

describe("clampPage", () => {
  it("reads the first page when there is no page in the URL", () => {
    expect(clampPage(undefined, 8)).toBe(1)
    expect(clampPage(null, 8)).toBe(1)
    expect(clampPage("", 8)).toBe(1)
  })

  it("keeps a page inside the list", () => {
    expect(clampPage("4", 8)).toBe(4)
  })

  it("falls back to the first page on anything that is not a number", () => {
    // `NaN` reaching `Math.min`/`Math.max` is how `?page=abc` becomes page NaN
    // and then an `OFFSET` Postgres rejects outright.
    expect(clampPage("abc", 8)).toBe(1)
    expect(clampPage("-", 8)).toBe(1)
    expect(clampPage("1.5.2", 8)).toBe(1)
  })

  it("never returns a page below one", () => {
    // The negative-offset case: `OFFSET -20` is an error, not an empty result.
    expect(clampPage("0", 8)).toBe(1)
    expect(clampPage("-3", 8)).toBe(1)
  })

  it("clamps a stale page to the last one that exists", () => {
    // The link-pasted-from-a-fuller-state case: the shelf shrank, or the reader
    // guessed. Landing on the end beats an empty page that says page 40.
    expect(clampPage("40", 8)).toBe(8)
  })

  it("treats an empty list as one page", () => {
    expect(clampPage("7", 0)).toBe(1)
  })
})

describe("pageWindow", () => {
  it("lists every page when there are few enough of them", () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("windows the middle and marks the gaps", () => {
    expect(pageWindow(10, 20)).toEqual([1, "gap", 8, 9, 10, 11, 12, "gap", 20])
  })

  it("keeps the last page reachable without holding down next", () => {
    // A window that ran off the end would leave the reader on the second-to-last
    // page with no numbered way past it.
    expect(pageWindow(19, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20])
  })

  it("leads with the first pages rather than trailing a gap", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20])
  })
})
