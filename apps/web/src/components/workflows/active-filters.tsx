'use client'

import { X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { trpc } from '@/lib/trpc/client'

interface ActiveFiltersProps {
  filters: {
    search?: string
    categorySlugs?: string[]
    priceType?: 'free' | 'paid'
    complexity?: 'beginner' | 'intermediate' | 'advanced'
    nodeTypes?: string[]
    certified?: boolean
    timePeriod?: '7d' | '1m' | '3m' | 'all'
    sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'popularity-desc'
  }
  onRemoveFilter: (filterType: string, value?: string) => void
  onClearAll: () => void
}

export function ActiveFilters({ filters, onRemoveFilter, onClearAll }: ActiveFiltersProps) {
  const t = useTranslations('Workflows.activeFilters')
  const locale = useLocale() as 'zh' | 'en'
  // 获取分类列表用于显示名称
  const { data: categoriesData } = trpc.categories.getAllCategories.useQuery()
  const categories = categoriesData?.success ? categoriesData.data || [] : []

  // 根据 locale 选择分类名称
  const getCategoryName = (category: (typeof categories)[number]) => {
    if (locale === 'zh') {
      return category.name || category.nameEn || ''
    }
    return category.nameEn || category.name || ''
  }
  const categoryMap = new Map(categories.map((cat) => [cat.slug, getCategoryName(cat)]))

  // 节点类型标签映射
  const nodeTypeLabels: Record<string, string> = {
    'n8n-nodes-base.set': 'Set',
    'n8n-nodes-base.httpRequest': 'HTTP Request',
    'n8n-nodes-base.code': 'Code',
    'n8n-nodes-base.if': 'IF',
    'n8n-nodes-base.webhook': 'Webhook',
  }

  // 时间段标签映射
  const timePeriodLabels: Record<string, string> = {
    '7d': t('timePeriod.7d'),
    '1m': t('timePeriod.1m'),
    '3m': t('timePeriod.3m'),
    all: t('timePeriod.all'),
  }

  // 价格类型标签映射
  const priceTypeLabels: Record<string, string> = {
    free: t('priceType.free'),
    paid: t('priceType.paid'),
  }

  // 复杂度标签映射
  const complexityLabels: Record<string, string> = {
    beginner: t('complexity.beginner'),
    intermediate: t('complexity.intermediate'),
    advanced: t('complexity.advanced'),
  }

  // 排序标签映射
  const sortLabels: Record<string, string> = {
    'date-desc': t('sort.dateDesc'),
    'date-asc': t('sort.dateAsc'),
    'downloads-desc': t('sort.downloadsDesc'),
    'views-desc': t('sort.viewsDesc'),
    'popularity-desc': t('sort.popularityDesc'),
  }

  // 收集所有活动的过滤条件
  const activeFilters: Array<{ type: string; label: string; value: string }> = []

  // 搜索关键词
  if (filters.search) {
    activeFilters.push({
      type: 'search',
      label: `${t('search')}: ${filters.search}`,
      value: filters.search,
    })
  }

  // 分类
  if (filters.categorySlugs && filters.categorySlugs.length > 0) {
    filters.categorySlugs.forEach((slug) => {
      activeFilters.push({
        type: 'categorySlugs',
        label: categoryMap.get(slug) || slug,
        value: slug,
      })
    })
  }

  // 价格类型
  if (filters.priceType) {
    activeFilters.push({
      type: 'priceType',
      label: priceTypeLabels[filters.priceType] || filters.priceType,
      value: filters.priceType,
    })
  }

  // 复杂度
  if (filters.complexity) {
    activeFilters.push({
      type: 'complexity',
      label: complexityLabels[filters.complexity] || filters.complexity,
      value: filters.complexity,
    })
  }

  // 节点类型
  if (filters.nodeTypes && filters.nodeTypes.length > 0) {
    filters.nodeTypes.forEach((nodeType) => {
      activeFilters.push({
        type: 'nodeTypes',
        label: nodeTypeLabels[nodeType] || nodeType,
        value: nodeType,
      })
    })
  }

  // 认证状态
  if (filters.certified !== undefined) {
    activeFilters.push({
      type: 'certified',
      label: t('certified'),
      value: 'true',
    })
  }

  // 时间段
  if (filters.timePeriod && filters.timePeriod !== 'all') {
    activeFilters.push({
      type: 'timePeriod',
      label: timePeriodLabels[filters.timePeriod] || filters.timePeriod,
      value: filters.timePeriod,
    })
  }

  // 排序（不显示默认排序）
  if (filters.sort && filters.sort !== 'date-desc') {
    const sortLabel = sortLabels[filters.sort] || filters.sort
    activeFilters.push({
      type: 'sort',
      label: `${t('sortLabel')}: ${sortLabel}`,
      value: filters.sort,
    })
  }

  // 如果没有活动的过滤条件，不显示
  if (activeFilters.length === 0) {
    return null
  }

  return (
    <div className='mb-6 flex flex-wrap items-center gap-2'>
      <span className='font-medium text-muted-foreground text-sm'>{t('selected')}</span>
      {activeFilters.map((filter, index) => (
        <Badge
          key={`${filter.type}-${filter.value}-${index}`}
          variant='secondary'
          className='flex items-center gap-1.5 px-3 py-1.5 text-sm'
        >
          <span>{filter.label}</span>
          <button
            type='button'
            onClick={() => onRemoveFilter(filter.type, filter.value)}
            className='ml-1 rounded-full p-0.5 transition-colors hover:bg-muted'
            aria-label={`${t('remove')} ${filter.label}`}
          >
            <X className='h-3 w-3' />
          </button>
        </Badge>
      ))}
      {activeFilters.length > 1 && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={onClearAll}
          className='h-7 text-muted-foreground text-xs hover:text-foreground'
        >
          {t('clearAll')}
        </Button>
      )}
    </div>
  )
}
