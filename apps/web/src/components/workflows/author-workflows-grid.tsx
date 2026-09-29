'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { Button } from '@workspace/ui/components/button'
import { WorkflowCard } from '@/components/workflows/workflow-card'
import type { WorkflowCardData } from './types'

interface AuthorWorkflowsGridProps {
  workflows: WorkflowCardData[]
  filters?: {
    category?: string
    timePeriod?: string
    price?: string
    sort?: string
  }
  loading?: boolean
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  onPageChange?: (page: number) => void
}

export function AuthorWorkflowsGrid({
  workflows,
  filters,
  loading,
  pagination,
  onPageChange,
}: AuthorWorkflowsGridProps) {
  const t = useTranslations('Workflows.grid')
  const locale = useLocale() as 'zh' | 'en'
  const filteredAndSortedWorkflows = useMemo(() => {
    let result = [...workflows]

    // Filter by category
    if (filters?.category) {
      result = result.filter((workflow) =>
        workflow.categories.some((cat) => cat.toLowerCase().includes(filters.category!.toLowerCase()))
      )
    }

    // Filter by price. `workflow.price` is a *localized* label, so matching on
    // it only ever worked on the zh locale; compare against the same labels
    // for the active locale instead.
    if (filters?.price) {
      const freeLabel = t('priceType.free')
      const paidLabel = t('priceType.paid')
      if (filters.price === 'free') {
        result = result.filter((workflow) => workflow.price === freeLabel)
      } else if (filters.price === 'paid') {
        result = result.filter((workflow) => workflow.price === paidLabel)
      }
    }
    // Filter by time period
    if (filters?.timePeriod && filters.timePeriod !== 'all') {
      const now = new Date()
      const cutoffDate = new Date()

      switch (filters.timePeriod) {
        case '7d':
          cutoffDate.setDate(now.getDate() - 7)
          break
        case '1m':
          cutoffDate.setMonth(now.getMonth() - 1)
          break
        case '3m':
          cutoffDate.setMonth(now.getMonth() - 3)
          break
        default:
          break
      }

      result = result.filter((workflow) => {
        const workflowDate = new Date(workflow.date)
        return workflowDate >= cutoffDate
      })
    }

    // Sort
    if (filters?.sort) {
      switch (filters.sort) {
        case 'date-desc':
          result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          break
        case 'date-asc':
          result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          break
        case 'downloads-desc':
          result.sort((a, b) => b.downloads - a.downloads)
          break
        case 'views-desc':
          result.sort((a, b) => b.views - a.views)
          break
        default:
          break
      }
    }

    return result
  }, [workflows, filters])

  // 如果加载完成且没有找到符合条件的工作流，显示没有找到符合条件的工作流提示
  // 注意：只有在加载完成（loading === false）且确实没有数据时才显示空状态
  // 如果正在加载，继续显示之前的数据（如果有的话）
  if (!loading && filteredAndSortedWorkflows.length === 0) {
    return (
      <div className='flex-1'>
        <div className='py-12 text-center'>
          <p className='text-lg text-muted-foreground'>{t('noWorkflowsFound')}</p>
          <p className='mt-2 text-muted-foreground text-sm'>{t('tryAdjustFilters')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex-1'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
        {filteredAndSortedWorkflows.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} />
        ))}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className='mt-12 flex flex-col items-center gap-4'>
          <div className='text-muted-foreground text-sm'>
            {locale === 'zh' ? (
              <>
                {t('Authors.workflows.showingRange', {
                  from: (pagination.page - 1) * pagination.limit + 1,
                  to: Math.min(pagination.page * pagination.limit, pagination.total),
                  total: pagination.total.toLocaleString(),
                })}
              </>
            ) : (
              <>
                Showing {(pagination.page - 1) * pagination.limit + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total.toLocaleString()} workflows
              </>
            )}
          </div>
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              {t('Authors.workflows.previous')}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              {t('Authors.workflows.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
