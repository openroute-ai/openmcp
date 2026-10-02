/**
 * Page-number arithmetic shared by every paged list.
 *
 * Two paginated surfaces, two shapes: the console's own tables hold their page in
 * client state and hand the next page to a callback, while the public pages are
 * server-rendered and answer with links so a page of a category can be shared and
 * crawled. Deciding *which* page numbers to show is the same question for both, so
 * it lives here rather than in whichever component happened to need it first —
 * and it lives outside a `"use client"` module so the server-rendered surface can
 * call it. A function exported from a client module cannot be called while
 * rendering on the server, which would have made this a copy.
 */

/** How many numbered links surround the current page. */
const WINDOW = 5

/**
 * The page numbers to show, with a gap marked for the middle.
 *
 * A window around the current page rather than every page: a log with thousands
 * of rows would otherwise render a control wider than the table it paginates.
 * The ends are always reachable — the window clamps to them, and a gap stands
 * in for what was skipped, so jumping to the first or last page never needs a
 * "next" held down.
 */
export function pageWindow(
  current: number,
  total: number
): Array<number | "gap"> {
  if (total <= WINDOW + 2) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  const start = Math.max(
    1,
    Math.min(current - Math.floor(WINDOW / 2), total - WINDOW + 1)
  )

  const pages: Array<number | "gap"> = []
  if (start > 1) pages.push(1, "gap")
  for (let page = start; page < start + WINDOW; page += 1) {
    pages.push(page)
  }
  if (start + WINDOW < total) pages.push("gap", total)
  return pages
}

/** How many pages a total fills at a page size. Never below one. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * The page a request actually asks for, clamped into `1…pageCount`.
 *
 * A page number arrives from a URL, so it arrives wrong: `?page=0`, `?page=-3`,
 * `?page=abc`, and — the one that matters on a live site — `?page=999` against a
 * category that now has three pages, because the shelf shrank or the link was
 * pasted from a fuller state. Clamping rather than erroring is the deliberate
 * choice, because these pages are anonymous and linkable: a reader who followed
 * a stale link should land on the last page that exists rather than be shown an
 * error for holding an out-of-date number. The bound matters beyond tidiness —
 * an unclamped value reaches SQL as an `OFFSET`, and a negative one is a query
 * error rather than an empty page.
 *
 * Page 1 is expressed as "no `?page=` at all" by the callers, so an unparsed or
 * missing value means the first page.
 */
export function clampPage(
  value: string | null | undefined,
  totalPages: number
): number {
  const pages = Math.max(1, totalPages)
  const page = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(page, 1), pages)
}
