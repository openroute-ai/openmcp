'use client'

import { Loader2 } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { McpToolCard } from './mcp-tool-card'

type McpToolListItem = {
  id: string
  toolName: string
  name?: string
  description: string | null
  descriptionEn: string | null
  isDeprecated: boolean
  createdAt: Date
  skill: { slug: string; title: string | null; titleEn: string | null }
}

interface McpToolsGridProps {
  tools: McpToolListItem[]
  isLoading?: boolean
  error?: Error | null
  pagination?: { page: number; limit: number; total: number; totalPages: number }
  onPageChange?: (page: number) => void
}

export function McpToolsGrid({ tools, isLoading, error, pagination, onPageChange }: McpToolsGridProps) {
  const locale = useLocale() as 'zh' | 'en'

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
          <p className='text-destructive text-lg'>加载工具列表失败，请稍后重试</p>
        </div>
      </div>
    )
  }

  if (tools.length === 0) {
    return (
      <div className='flex-1'>
        <div className='py-12 text-center'>
          <p className='text-lg text-muted-foreground'>没有找到符合条件的工具</p>
          <p className='mt-2 text-muted-foreground text-sm'>请尝试调整搜索条件</p>
        </div>
      </div>
    )
  }

  const skillTitle = (s: McpToolListItem['skill']) =>
    locale === 'zh' ? s.title || s.titleEn || '' : s.titleEn || s.title || ''

  const cardTools = tools.map((t) => ({
    id: t.id,
    toolName: t.toolName,
    name: t.name ?? t.toolName,
    description:
      (locale === 'zh' ? t.description || t.descriptionEn : t.descriptionEn || t.description) || '',
    skillSlug: t.skill.slug,
    skillTitle: skillTitle(t.skill),
    isDeprecated: t.isDeprecated,
    date: t.createdAt.toISOString().split('T')[0] ?? '',
  }))

  return (
    <div className='flex-1'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
        {cardTools.map((tool) => (
          <McpToolCard key={tool.id} tool={tool} />
        ))}
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className='mt-12 flex flex-col items-center gap-4'>
          <div className='text-muted-foreground text-sm'>
            显示 {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)} 个工具，共{' '}
            {pagination.total.toLocaleString()} 个
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              type='button'
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              上一页
            </Button>
            <Button
              variant='outline'
              type='button'
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
