'use client'

import { useTranslations } from 'next-intl'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@workspace/ui/components/pagination'
import { useLocalePathname, useLocaleRouter } from '@/i18n/navigation'

function getCurrentPageFromPath(pathname: string): number {
  const match = pathname.match(/\/page\/(\d+)$/)
  if (match?.[1]) {
    return Number(match[1])
  }
  return 1
}

type CustomPaginationProps = {
  totalPages: number
  routePreix: string
}

export default function CustomPagination({ totalPages, routePreix }: CustomPaginationProps) {
  const router = useLocaleRouter()
  const pathname = useLocalePathname()
  const currentPage = getCurrentPageFromPath(pathname)
  const t = useTranslations('BlogPage.pagination')
  const handlePageChange = (page: number | string) => {
    const pageNum = Number(page)
    if (pageNum === 1) {
      // Go to /blog or /blog/category/[slug] for page 1
      router.push(routePreix)
    } else {
      // Go to /blog/page/x or /blog/category/[slug]/page/x
      router.push(`${routePreix}/page/${pageNum}`)
    }
  }

  const allPages = generatePagination(currentPage, totalPages)

  return (
    <div className='flex flex-col gap-2'>
      {/* Screen reader information */}
      <div className='sr-only' aria-live='polite'>
        {t('currentPage', { page: currentPage })} {t('totalPages', { totalPages })}
      </div>
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={currentPage > 1 ? () => handlePageChange(currentPage - 1) : undefined}
                title={t('previousPage')}
                aria-label={t('previousPage')}
                aria-disabled={currentPage <= 1}
                className={currentPage <= 1 ? 'pointer-events-none text-gray-300 dark:text-gray-600' : 'cursor-pointer'}
              >
                {t('previousPage')}
              </PaginationPrevious>
            </PaginationItem>
            {allPages.map((page, index) => (
              <PaginationItem key={`${page}-${index}`}>
                {page === '...' ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink
                    onClick={() => handlePageChange(page)}
                    isActive={currentPage === page}
                    className={currentPage === page ? '' : 'cursor-pointer'}
                    title={t('goToPage', { page: page })}
                    aria-label={t('goToPage', { page: page })}
                    aria-current={currentPage === page ? 'page' : undefined}
                  >
                    {page}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}

            <PaginationItem>
              <PaginationNext
                onClick={currentPage < totalPages ? () => handlePageChange(currentPage + 1) : undefined}
                aria-disabled={currentPage >= totalPages}
                className={
                  currentPage >= totalPages ? 'pointer-events-none text-gray-300 dark:text-gray-600' : 'cursor-pointer'
                }
                title={t('nextPage')}
                aria-label={t('nextPage')}
              >
                {t('nextPage')}
              </PaginationNext>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}

/**
 * Generate an array of page numbers to display in the pagination component
 */
const generatePagination = (currentPage: number, totalPages: number) => {
  // If the total number of pages is 7 or less,
  // display all pages without any ellipsis.
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  // If the current page is among the first 3 pages,
  // show the first 3, an ellipsis, and the last 2 pages.
  if (currentPage <= 3) {
    return [1, 2, 3, '...', totalPages - 1, totalPages]
  }

  // If the current page is among the last 3 pages,
  // show the first 2, an ellipsis, and the last 3 pages.
  if (currentPage >= totalPages - 2) {
    return [1, 2, '...', totalPages - 2, totalPages - 1, totalPages]
  }

  // If the current page is somewhere in the middle,
  // show the first page, an ellipsis, the current page and its neighbors,
  // another ellipsis, and the last page.
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

function normalizePath(path: string) {
  // Remove duplicated locale prefix, e.g. /zh/zh/blog => /zh/blog
  return path.replace(/^(\/\w{2,3})(?:\1)+/, '$1')
}
