"use client"

import { useTranslations } from "next-intl"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@workspace/ui/components/pagination"

import { pageWindow } from "@/lib/pagination"

export interface DataPaginationProps {
  page: number
  pageCount: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

/**
 * The page controls under a server-paged table.
 *
 * Renders nothing for a single page, so a short list does not get a control
 * that can only ever do nothing. The range is stated in words as well as shown
 * by the links, because "page 4" alone does not say how much of the log is
 * being paged through.
 */
export function DataPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
}: DataPaginationProps) {
  const t = useTranslations("Common")
  if (pageCount <= 1) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
      <span className="text-sm text-muted-foreground">
        {t("pageSummary", {
          from: (page - 1) * pageSize + 1,
          to: Math.min(page * pageSize, total),
          total,
        })}
      </span>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              text={t("previousPage")}
              aria-disabled={page <= 1}
              className={
                page <= 1 ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(event) => {
                event.preventDefault()
                if (page > 1) onPageChange(page - 1)
              }}
            />
          </PaginationItem>
          {pageWindow(page, pageCount).map((entry, index) =>
            entry === "gap" ? (
              <PaginationItem key={`gap-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={entry}>
                <PaginationLink
                  href="#"
                  isActive={entry === page}
                  aria-label={t("goToPage", { page: entry })}
                  onClick={(event) => {
                    event.preventDefault()
                    onPageChange(entry)
                  }}
                >
                  {entry}
                </PaginationLink>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              text={t("nextPage")}
              aria-disabled={page >= pageCount}
              className={
                page >= pageCount ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(event) => {
                event.preventDefault()
                if (page < pageCount) onPageChange(page + 1)
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
