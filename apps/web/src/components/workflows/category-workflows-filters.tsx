'use client'

import { ChevronDown, Clock, DollarSign, Filter } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'

interface CategoryWorkflowsFiltersProps {
  onFilterChange?: (filters: { timePeriod?: string; price?: string; sort?: string }) => void
  initialFilters?: {
    timePeriod?: string
    price?: string
    sort?: string
  }
}

export function CategoryWorkflowsFilters({ onFilterChange, initialFilters }: CategoryWorkflowsFiltersProps) {
  const t = useTranslations('Workflows.filters')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [selectedTime, setSelectedTime] = useState(initialFilters?.timePeriod || 'all')
  const [selectedPrice, setSelectedPrice] = useState(initialFilters?.price || 'all')
  const [selectedSort, setSelectedSort] = useState(initialFilters?.sort || 'date-desc')

  // 当初始值变化时同步状态（用于 URL 参数变化）
  useEffect(() => {
    if (initialFilters) {
      if (initialFilters.timePeriod !== undefined) {
        setSelectedTime(initialFilters.timePeriod || 'all')
      }
      if (initialFilters.price !== undefined) {
        setSelectedPrice(initialFilters.price || 'all')
      }
      if (initialFilters.sort !== undefined) {
        setSelectedSort(initialFilters.sort || 'date-desc')
      }
    }
  }, [initialFilters])

  const timePeriods = [
    { value: 'all', label: t('allTime'), count: 0 },
    { value: '7d', label: t('last7Days'), count: 0 },
    { value: '1m', label: t('lastMonth'), count: 0 },
    { value: '3m', label: t('last3Months'), count: 0 },
  ]

  const priceOptions = [
    { value: 'all', label: t('all') },
    { value: 'free', label: t('free') },
    { value: 'paid', label: t('paid') },
  ]

  const handleTimeChange = (value: string) => {
    setSelectedTime(value)
    onFilterChange?.({
      timePeriod: value === 'all' ? undefined : value,
      price: selectedPrice === 'all' ? undefined : selectedPrice,
      sort: selectedSort,
    })
  }

  const handlePriceChange = (value: string) => {
    setSelectedPrice(value)
    onFilterChange?.({
      timePeriod: selectedTime === 'all' ? undefined : selectedTime,
      price: value === 'all' ? undefined : value,
      sort: selectedSort,
    })
  }

  const handleSortChange = (value: string) => {
    setSelectedSort(value)
    onFilterChange?.({
      timePeriod: selectedTime === 'all' ? undefined : selectedTime,
      price: selectedPrice === 'all' ? undefined : selectedPrice,
      sort: value,
    })
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
            {t('title')}
          </span>
          <ChevronDown className={`h-5 w-5 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Filters Sidebar */}
      <aside className={`w-full shrink-0 space-y-6 lg:w-64 ${mobileFiltersOpen ? 'block' : 'hidden lg:block'}`}>
        {/* Price Filter */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <DollarSign className='mr-2 h-4 w-4 text-primary' />
            {t('price')}
          </h3>
          <div className='space-y-2'>
            {priceOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handlePriceChange(option.value)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${selectedPrice === option.value
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Time Period Filter */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Clock className='mr-2 h-4 w-4 text-primary' />
            {t('timePeriod')}
          </h3>
          <div className='space-y-2'>
            {timePeriods.map((period) => (
              <button
                key={period.value}
                onClick={() => handleTimeChange(period.value)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${selectedTime === period.value
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <span>{period.label}</span>
                {period.count > 0 && <span className='rounded-full bg-muted px-2 py-1 text-xs'>{period.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Sort Selector */}
        <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
          <h3 className='mb-4 flex items-center font-medium text-foreground'>
            <Filter className='mr-2 h-4 w-4 text-primary' />
            {t('sort')}
          </h3>
          <Select value={selectedSort} onValueChange={handleSortChange}>
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='date-desc'>{t('sortBy.dateDesc')}</SelectItem>
              <SelectItem value='date-asc'>{t('sortBy.dateAsc')}</SelectItem>
              <SelectItem value='downloads-desc'>{t('sortBy.downloadsDesc')}</SelectItem>
              <SelectItem value='views-desc'>{t('sortBy.viewsDesc')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </aside>
    </>
  )
}
