'use client'

import { ChevronDown, Clock, Filter, Settings, Tag } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { useTranslations } from 'next-intl'
import { websiteConfig } from '@/lib/config/website'
import { trpc } from '@/lib/trpc/client'

interface WorkflowsFiltersProps {
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
  onFilterChange: (filters: Partial<WorkflowsFiltersProps['filters']>) => void
}

export function WorkflowsFilters({ filters, onFilterChange }: WorkflowsFiltersProps) {
  const t = useTranslations('Workflows')
  const donationQrUrl = websiteConfig.donationQrUrl
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [donationDialogOpen, setDonationDialogOpen] = useState(false)

  // 获取分类列表
  const { data: categoriesData } = trpc.categories.getAllCategories.useQuery()
  const categories = categoriesData?.success ? categoriesData.data || [] : []

  // 获取节点类型统计（这里简化处理，实际可以从数据库获取）
  const nodeTypes = [
    { value: 'n8n-nodes-base.set', label: 'Set', count: 0 },
    { value: 'n8n-nodes-base.httpRequest', label: 'HTTP Request', count: 0 },
    { value: 'n8n-nodes-base.code', label: 'Code', count: 0 },
    { value: 'n8n-nodes-base.if', label: 'IF', count: 0 },
    { value: 'n8n-nodes-base.webhook', label: 'Webhook', count: 0 },
  ]

  const timePeriods = [
    { value: 'all', label: t('filters.allTime'), count: 0 },
    { value: '7d', label: t('filters.last7Days'), count: 0 },
    { value: '1m', label: t('filters.lastMonth'), count: 0 },
    { value: '3m', label: t('filters.last3Months'), count: 0 },
  ]

  const priceTypes = [
    { value: 'all', label: t('filters.all') },
    { value: 'free', label: t('filters.free'), count: 0 },
    { value: 'paid', label: t('filters.paid'), count: 0 },
  ]

  const handleTimeChange = (value: string) => {
    onFilterChange({ timePeriod: value === 'all' ? undefined : (value as '7d' | '1m' | '3m') })
  }

  const handlePriceChange = (value: string) => {
    onFilterChange({ priceType: value === 'all' ? undefined : (value as 'free' | 'paid') })
  }

  const handleSortChange = (value: string) => {
    onFilterChange({ sort: value as typeof filters.sort })
  }

  const handleCategoryToggle = (categorySlug: string) => {
    const currentSlugs = filters.categorySlugs || []
    const newSlugs = currentSlugs.includes(categorySlug)
      ? currentSlugs.filter((s) => s !== categorySlug)
      : [...currentSlugs, categorySlug]
    onFilterChange({ categorySlugs: newSlugs.length > 0 ? newSlugs : undefined })
  }

  const handleNodeTypeToggle = (nodeType: string) => {
    const currentTypes = filters.nodeTypes || []
    const newTypes = currentTypes.includes(nodeType)
      ? currentTypes.filter((t) => t !== nodeType)
      : [...currentTypes, nodeType]
    onFilterChange({ nodeTypes: newTypes.length > 0 ? newTypes : undefined })
  }

  return (
    <>
      {/* Mobile Filter Toggle */}
      <div className='mb-4 lg:hidden'>
        <Button
          variant='outline'
          className='flex w-full items-center justify-between bg-transparent'
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
        >
          <span className='flex items-center'>
            <Filter className='mr-2 h-5 w-5' />
            {t('filters.titleMobile')}
          </span>
          <ChevronDown className={`h-5 w-5 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Filters Sidebar */}
      <aside className={`w-full shrink-0 space-y-6 lg:w-64 ${mobileFiltersOpen ? 'block' : 'hidden lg:block'}`}>
        {/* Donation Button */}
        <div className='w-full'>
          <Button
            type='button'
            onClick={() => setDonationDialogOpen(true)}
            className='flex w-full items-center justify-center rounded-lg bg-[#FFD447] px-4 py-2 font-medium text-gray-900 text-sm shadow-sm transition-colors hover:bg-[#e6c040] hover:shadow-md'
          >
            <svg className='h-6 w-6' viewBox='0 0 24 24' fill='currentColor'>
              <path d='M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-.766-1.623a4.596 4.596 0 0 0-1.364-1.24c-.253-.126-.53-.207-.816-.241-.284-.034-.572-.014-.854.058a4.533 4.533 0 0 0-2.029 1.08l-.132.132-.132-.132a4.533 4.533 0 0 0-2.029-1.08 2.78 2.78 0 0 0-.854-.058c-.286.034-.563.115-.816.241a4.596 4.596 0 0 0-1.364 1.24c-.378.46-.647 1.025-.766 1.623l-.132.666a6.963 6.963 0 0 0 .407 3.746c.346.835.834 1.593 1.429 2.22l4.132 4.132a.749.749 0 0 0 1.06 0l4.132-4.132c.595-.627 1.083-1.385 1.429-2.22a6.963 6.963 0 0 0 .407-3.746z' />
            </svg>
            {t('filters.supportAuthor')}
          </Button>
        </div>

        {/* Donation Dialog */}
        <Dialog open={donationDialogOpen} onOpenChange={setDonationDialogOpen}>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle className='text-center text-xl'>{t('filters.supportTitle')}</DialogTitle>
              <DialogDescription className='pt-2 text-center'>
                {t('filters.supportDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-col items-center gap-4 py-4'>
              {donationQrUrl && (
                <div className='relative h-64 w-64'>
                  <Image src={donationQrUrl} alt={t('filters.supportQrAlt')} fill className='object-contain' priority />
                </div>
              )}
              <p className='px-4 text-center text-muted-foreground text-sm'>
                {t('filters.supportHint')}
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Time Period Filter */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Clock className='mr-2 h-4 w-4 text-primary' />
            {t('filters.timePeriod')}
          </h3>
          <div className='space-y-2'>
            {timePeriods.map((period) => (
              <button
                key={period.value}
                onClick={() => handleTimeChange(period.value)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  filters.timePeriod === period.value || (!filters.timePeriod && period.value === 'all')
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>{period.label}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Price Type Filter */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Tag className='mr-2 h-4 w-4 text-primary' />
            {t('filters.price')}
          </h3>
          <div className='space-y-2'>
            {priceTypes.map((priceType) => (
              <button
                key={priceType.value}
                onClick={() => handlePriceChange(priceType.value)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  filters.priceType === priceType.value || (!filters.priceType && priceType.value === 'all')
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>{priceType.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sort Selector */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Filter className='mr-2 h-4 w-4 text-primary' />
            {t('filters.sort')}
          </h3>
          <Select value={filters.sort || 'date-desc'} onValueChange={handleSortChange}>
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='date-desc'>{t('filters.sortBy.dateDesc')}</SelectItem>
              <SelectItem value='date-asc'>{t('filters.sortBy.dateAsc')}</SelectItem>
              <SelectItem value='downloads-desc'>{t('filters.sortBy.downloadsDesc')}</SelectItem>
              <SelectItem value='views-desc'>{t('filters.sortBy.viewsDesc')}</SelectItem>
              <SelectItem value='popularity-desc'>{t('filters.sortBy.popularityDesc')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Categories Filter */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Filter className='mr-2 h-4 w-4 text-primary' />
            {t('filters.category')}
          </h3>
          <div className='max-h-64 space-y-2 overflow-y-auto'>
            {categories.map((category) => {
              const isSelected = filters.categorySlugs?.includes(category.slug)
              return (
                <button
                  key={category.id}
                  onClick={() => handleCategoryToggle(category.slug)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span>{category.name}</span>
                  <span className='rounded-full bg-muted px-2 py-1 text-xs'>{category.workflowCount}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Node Types Filter */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Settings className='mr-2 h-4 w-4 text-primary' />
            {t('filters.nodeTypes')}
          </h3>
          <div className='max-h-80 space-y-2 overflow-y-auto'>
            {nodeTypes.map((node) => {
              const isSelected = filters.nodeTypes?.includes(node.value)
              return (
                <button
                  key={node.value}
                  onClick={() => handleNodeTypeToggle(node.value)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span>{node.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </aside>
    </>
  )
}
