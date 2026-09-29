'use client'

import type React from 'react'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@workspace/ui/components/pagination'
import { cn } from '@/lib/utils'

interface PaginationBoxProps {
  page: number
  count: number
  pageSize: number
  onPageChange: (page: number) => void
  className?: string
  translations?: {
    previousPage?: string
    nextPage?: string
  }
}

const PaginationBox: React.FC<PaginationBoxProps> = ({
  page,
  count,
  pageSize,
  onPageChange,
  className,
  translations,
}) => {
  if (count <= pageSize) {
    return null
  }

  const totalPages = Math.ceil(count / pageSize)
  const maxVisiblePages = 7 // Element UI 默认显示7个页码
  const halfVisible = Math.floor(maxVisiblePages / 2)

  const renderPaginationItems = () => {
    const items = []
    let showLeftEllipsis = false
    let showRightEllipsis = false

    if (totalPages > maxVisiblePages) {
      if (page > maxVisiblePages - halfVisible) {
        showLeftEllipsis = true
      }
      if (page < totalPages - halfVisible) {
        showRightEllipsis = true
      }
    }

    // 添加第一页
    items.push(
      <PaginationItem key={1}>
        <PaginationLink href='#' isActive={1 === page} onClick={() => onPageChange(1)}>
          1
        </PaginationLink>
      </PaginationItem>
    )

    // 左侧省略号
    if (showLeftEllipsis) {
      items.push(
        <PaginationItem key='left-ellipsis'>
          <PaginationEllipsis className='cursor-pointer' onClick={() => onPageChange(page - 5 < 1 ? 1 : page - 5)} />
        </PaginationItem>
      )
    }

    // 中间页码
    let startPage = 2
    let endPage = totalPages - 1

    if (showLeftEllipsis && showRightEllipsis) {
      startPage = page - halfVisible
      endPage = page + halfVisible
    } else if (showLeftEllipsis) {
      startPage = totalPages - (maxVisiblePages - 2)
    } else if (showRightEllipsis) {
      endPage = maxVisiblePages - 1
    }

    for (let i = startPage; i <= endPage; i++) {
      if (i > 1 && i < totalPages) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink href='#' isActive={i === page} onClick={() => onPageChange(i)}>
              {i}
            </PaginationLink>
          </PaginationItem>
        )
      }
    }

    // 右侧省略号
    if (showRightEllipsis) {
      items.push(
        <PaginationItem key='right-ellipsis'>
          <PaginationEllipsis
            className='cursor-pointer'
            onClick={() => onPageChange(page + 5 > totalPages ? totalPages : page + 5)}
          />
        </PaginationItem>
      )
    }

    // 添加最后一页
    if (totalPages > 1) {
      items.push(
        <PaginationItem key={totalPages}>
          <PaginationLink href='#' isActive={totalPages === page} onClick={() => onPageChange(totalPages)}>
            {totalPages}
          </PaginationLink>
        </PaginationItem>
      )
    }

    return items
  }

  return (
    <div className={cn('mt-auto border-t px-6 py-4', className)}>
      <Pagination>
        <PaginationContent className='bg-background'>
          <PaginationItem>
            <PaginationPrevious
              href='#'
              onClick={() => page > 1 && onPageChange(page - 1)}
              className={page === 1 ? 'cursor-not-allowed opacity-50' : ''}
            >
              {translations?.previousPage}
            </PaginationPrevious>
          </PaginationItem>
          {renderPaginationItems()}
          <PaginationItem>
            <PaginationNext
              href='#'
              onClick={() => page < totalPages && onPageChange(page + 1)}
              className={page === totalPages ? 'cursor-not-allowed opacity-50' : ''}
            >
              {translations?.nextPage}
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}

export default PaginationBox
