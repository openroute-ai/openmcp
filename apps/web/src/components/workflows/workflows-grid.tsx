'use client'

import { Button } from '@workspace/ui/components/button'
import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { WorkflowCard } from '@/components/workflows/workflow-card'
import { convertToWorkflowCardData } from './types'

// 工作流列表返回的简化类型（不包含所有字段）
type WorkflowListItem = {
  id: string
  referenceId: string
  slug: string
  title: string | null
  titleEn?: string | null
  description: string | null
  descriptionEn: string | null
  imageUrl: string | null
  priceType: 'free' | 'paid'
  complexity: 'beginner' | 'intermediate' | 'advanced' | null
  certified: boolean
  views: number
  downloads: number
  publishedAt: Date | null
  createdAt: Date
  author?: {
    id: string
    name: string
    username: string
    avatar: string | null
    verified: boolean
  }
  categories?: Array<{
    id: string
    name: string
    nameEn: string
    slug: string
  }>
  nodeTypes?: string[]
}

interface WorkflowsGridProps {
  workflows: WorkflowListItem[]
  isLoading?: boolean
  error?: Error | null
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  onPageChange?: (page: number) => void
}

export function WorkflowsGrid({ workflows, isLoading, error, pagination, onPageChange }: WorkflowsGridProps) {
  const locale = useLocale() as 'zh' | 'en'
  const t = useTranslations('Workflows')

  if (isLoading) {
    return (
      <div className='flex-1'>
        <div className='flex min-h-[400px] items-center justify-center'>
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex-1'>
        <div className='py-12 text-center'>
          <p className='text-destructive text-lg'>{t('grid.loadError')}</p>
        </div>
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <div className='flex-1'>
        <div className='py-12 text-center'>
          <p className='text-lg text-muted-foreground'>{t('grid.empty')}</p>
          <p className='mt-2 text-muted-foreground text-sm'>{t('grid.emptyHint')}</p>
        </div>
      </div>
    )
  }

  // 转换数据格式以匹配 WorkflowCard 组件，根据 locale 本地化字段
  // 需要将 WorkflowListItem 转换为完整的 Workflow 类型（添加缺失字段的默认值）
  const formattedWorkflows = workflows.map((w) => {
    // 创建一个临时的完整 Workflow 对象，添加缺失字段的默认值
    const fullWorkflow = {
      ...w,
      title: w.title || '',
      titleEn: w.titleEn ?? null,
      description: w.description,
      descriptionEn: w.descriptionEn,
      summary: null,
      metaDescription: null,
      authorId: w?.author?.id || '',
      workflowUrl: null,
      workflowJson: null,
      readme: null,
      readmeEn: null,
      priceAmount: null,
      currency: null,
      certifiedAt: null,
      verificationCount: 0,
      popularity: 0,
      likes: 0,
      status: 'published' as const,
      updatedAt: w.createdAt,
      // 确保 categories 字段存在
      categories: w.categories || [],
      // 确保 nodeTypes 字段存在
      nodeTypes: w.nodeTypes || [],
      // 确保 author 字段存在
      author: w.author || {
        id: '',
        name: '',
        username: '',
        avatar: null,
        verified: false,
      },
    }
    return convertToWorkflowCardData(fullWorkflow, locale)
  })

  return (
    <div className='flex-1'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
        {formattedWorkflows.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} />
        ))}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className='mt-12 flex flex-col items-center gap-4'>
          <div className='text-muted-foreground text-sm'>
            {t('grid.showing', {
              from: (pagination.page - 1) * pagination.limit + 1,
              to: Math.min(pagination.page * pagination.limit, pagination.total),
              total: pagination.total.toLocaleString(),
            })}
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              {t('grid.previous')}
            </Button>
            <Button
              variant='outline'
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              {t('grid.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
