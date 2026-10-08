import { Button } from "@workspace/ui/components/button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@workspace/ui/components/pagination"

import { LocaleLink } from "@/i18n/navigation"
import { pageWindow } from "@/lib/pagination"

/**
 * The page controls under a server-paged public list.
 *
 * Links rather than the console's `DataPagination`, and that is the whole
 * difference between the two surfaces. `DataPagination` holds its page in client
 * state and calls back into React Query, which is right for a table behind a
 * session and wrong here: a public page is reached by shared links, by crawlers
 * and by agents fetching a URL, and none of those run the callback. A number in
 * the address bar is also the only version of "page 3 of a category" that can be
 * bookmarked, cited or crawled, and on a list this long the middle pages are
 * exactly the ones a reader wants to come back to.
 *
 * `PaginationLink` is not used for the numbered pages, and `Button asChild` is
 * what it does internally: the primitive renders a bare `<a>`, which would drop
 * the locale prefix that every link on this site carries. Going through `Button`
 * directly keeps the primitive's own appearance — same variant, same size — while
 * letting the anchor be a `LocaleLink`. Prev/next need no such care and use the
 * primitives as they are.
 *
 * Chinese only, like the rest of the public surface (see `public-shell.tsx`):
 * these pages are reached by shared links rather than by a reader choosing a
 * locale, and the landing page has no translated copy either.
 */

export interface PublicPaginationProps {
  page: number
  pageCount: number
  /** The paged path with no query on it — page 1 is that path as-is. */
  href: string
  /**
   * The list's own query — filters, sort, keyword — as produced by
   * `projectsQueryString`: no leading `?` and never a `page` key.
   *
   * A filtered list that dropped it on page three would send the reader back to
   * the unfiltered first page; page links re-append it so every page of a
   * filtered list keeps the same framing, and page one of the default state
   * still collapses to the bare path.
   */
  search?: string
  /**
   * The filter this list is scoped by, carried on every page link.
   * Alternative to `search` string.
   */
  params?: Record<string, string>
}

/**
 * The href for one page.
 *
 * Page one is the bare path on purpose. It is what the category nav links to, so
 * it is the canonical address of this list; leaving `?page=1` off means the link
 * every page shares and the URL a reader copies are one string, and a category
 * cannot end up with two addresses for its own first page. The same applies when
 * the list is filtered: page one carries the filters but no `page` key.
 */
function pageHref(
  href: string,
  page: number,
  params?: Record<string, string>,
  search?: string
): string {
  const sp = new URLSearchParams(search ?? "")
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) sp.set(k, v)
    })
  }
  if (page > 1) sp.set("page", String(page))
  const query = sp.toString()
  return query ? `${href}?${query}` : href
}

/**
 * One numbered page link.
 *
 * `variant` follows what `PaginationLink` does with `isActive`, so the current
 * page looks like the console's current page: outlined rather than ghost. The
 * outline plus `aria-current` is what says "you are here" — the number alone does
 * not, and colour alone never does.
 */
function PageNumber({
  href,
  page,
  current,
}: {
  href: string
  page: number
  current: number
}) {
  return (
    <Button
      asChild
      variant={page === current ? "outline" : "ghost"}
      size="icon"
      className="tabular-nums"
    >
      <LocaleLink
        href={href}
        aria-label={`第 ${page} 页`}
        aria-current={page === current ? "page" : undefined}
      >
        {page}
      </LocaleLink>
    </Button>
  )
}

/**
 * Renders nothing when there is a single page, so a short list gets no control
 * that can only ever do nothing.
 */
export function PublicPagination({
  page,
  pageCount,
  href,
  search,
  params,
}: PublicPaginationProps) {
  if (pageCount <= 1) return null

  return (
    <div className="mt-8 flex justify-center border-t border-border pt-6">
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href={pageHref(href, page - 1, params, search)}
              text="上一页"
              aria-disabled={page <= 1}
              className={
                page <= 1 ? "pointer-events-none opacity-50" : undefined
              }
            />
          </PaginationItem>

          {pageWindow(page, pageCount).map((entry, index) =>
            entry === "gap" ? (
              <PaginationItem key={`gap-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={entry}>
                <PageNumber
                  href={pageHref(href, entry, params, search)}
                  page={entry}
                  current={page}
                />
              </PaginationItem>
            )
          )}

          <PaginationItem>
            <PaginationNext
              href={pageHref(href, page + 1, params, search)}
              text="下一页"
              aria-disabled={page >= pageCount}
              className={
                page >= pageCount ? "pointer-events-none opacity-50" : undefined
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
