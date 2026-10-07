'use client'

import { Button } from '@workspace/ui/components/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { ChevronDown, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils/index'

export type SkillsFilters = {
  search?: string
  categorySlugs?: string[]
  priceType?: 'free' | 'paid'
  certified?: boolean
  timePeriod?: '7d' | '1m' | '3m' | 'all'
  sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'popularity-desc'
}

type SortTab = 'all' | 'rising' | 'downloads' | 'newest'

interface SkillsHeroProps {
  totalSkills?: number
  initialSearch?: string
  filters: SkillsFilters
  onSearch: (search: string) => void
  onFilterChange: (patch: Partial<SkillsFilters>) => void
}

const sortTabs: { key: SortTab; labelKey: 'all' | 'rising' | 'downloads' | 'newest' }[] = [
  { key: 'all', labelKey: 'all' },
  { key: 'rising', labelKey: 'rising' },
  { key: 'downloads', labelKey: 'downloads' },
  { key: 'newest', labelKey: 'newest' },
]

const sortOptions: {
  value: SkillsFilters['sort']
  labelKey: 'dateDesc' | 'dateAsc' | 'downloadsDesc' | 'viewsDesc' | 'popularityDesc'
}[] = [
  { value: 'date-desc', labelKey: 'dateDesc' },
  { value: 'date-asc', labelKey: 'dateAsc' },
  { value: 'downloads-desc', labelKey: 'downloadsDesc' },
  { value: 'views-desc', labelKey: 'viewsDesc' },
  { value: 'popularity-desc', labelKey: 'popularityDesc' },
]

export function SkillsHero({
  totalSkills = 0,
  initialSearch = '',
  filters,
  onSearch,
  onFilterChange,
}: SkillsHeroProps) {
  const t = useTranslations('Skills.hero')
  const [searchQuery, setSearchQuery] = useState(initialSearch)

  useEffect(() => {
    setSearchQuery(initialSearch)
  }, [initialSearch])

  const { data: categoriesData } = trpc.categories.getAllCategories.useQuery(undefined, { retry: false })
  const categories = useMemo(() => (categoriesData?.success ? (categoriesData.data ?? []) : []), [categoriesData])

  const activeTab: SortTab = useMemo(() => {
    const { sort, timePeriod } = filters
    if (timePeriod === '7d') return 'rising'
    if (sort === 'downloads-desc') return 'downloads'
    if (sort === 'date-desc') return 'newest'
    return 'all'
  }, [filters])

  const handleTab = (tab: SortTab) => {
    if (tab === 'all') onFilterChange({ sort: 'popularity-desc', timePeriod: undefined })
    else if (tab === 'rising') onFilterChange({ sort: 'popularity-desc', timePeriod: '7d' })
    else if (tab === 'downloads') onFilterChange({ sort: 'downloads-desc', timePeriod: undefined })
    else onFilterChange({ sort: 'date-desc', timePeriod: undefined })
  }

  const handleCategory = (value: string) => {
    onFilterChange({ categorySlugs: value === 'all' ? undefined : [value] })
  }

  const handlePrice = (value: string) => {
    onFilterChange({ priceType: value === 'all' ? undefined : (value as 'free' | 'paid') })
  }

  const handleCertified = (value: string) => {
    onFilterChange({ certified: value === 'all' ? undefined : true })
  }

  const handleSort = (value: string) => {
    onFilterChange({ sort: value as SkillsFilters['sort'], timePeriod: undefined })
  }

  const selectCls =
    'h-[34px] rounded-[8px] border-border border bg-card px-[12px] text-[13px] font-medium text-foreground'

  return (
    <div className='mx-auto w-full max-w-page px-5 py-10 sm:px-6 lg:px-10'>
      {/* Hero：左对齐标题 + 技能总数 */}
      <div className='mb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
        <div className='min-w-0'>
          <h1 className='font-medium text-foreground text-title tracking-tight'>{t('title')}</h1>
          <p className='font-medium text-[14px] text-muted-foreground'>
            {t('subtitle')}
            <span className='text-muted-foreground/70'>
              {' '}
              · {t('countSeparator')} {totalSkills.toLocaleString()} {t('countSuffix')}
            </span>
          </p>
        </div>
      </div>

      {/* 搜索结果栏：搜索框 + 搜索按钮 */}
      <div className='mb-4 flex items-center gap-[10px]'>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSearch(searchQuery)
          }}
          className='flex min-w-0 flex-1 items-center gap-[10px]'
        >
          <div className='relative min-w-0 flex-1'>
            <Search className='pointer-events-none absolute top-1/2 left-[13px] h-[16px] w-[16px] -translate-y-1/2 text-muted-foreground/60' />
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className='h-[40px] w-full rounded-[12px] border border-border bg-card pr-[14px] pl-[38px] text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/20'
            />
          </div>
          <Button
            type='submit'
            size='sm'
            className='h-[40px] shrink-0 rounded-[12px] px-[18px] font-medium text-[13px]'
          >
            {t('searchButton')}
          </Button>
        </form>
      </div>

      {/* 筛选区（桌面端）：排序 Tab + 下拉筛选 */}
      <div className='mb-4 hidden items-center justify-between gap-4 lg:flex'>
        <div className='flex shrink-0 items-center gap-1'>
          {sortTabs.map((tab) => (
            <button
              key={tab.key}
              type='button'
              onClick={() => handleTab(tab.key)}
              className={cn(
                'h-[34px] whitespace-nowrap rounded-[8px] px-[12px] font-medium text-[13px] transition-colors duration-150',
                activeTab === tab.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {t(`tabs.${tab.labelKey}`)}
            </button>
          ))}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Select value={filters.categorySlugs?.[0] ?? 'all'} onValueChange={handleCategory}>
            <SelectTrigger className={selectCls} aria-label={t('categoryLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('allCategories')}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={filters.priceType ?? 'all'} onValueChange={handlePrice}>
            <SelectTrigger className={selectCls} aria-label={t('priceLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('allPrices')}</SelectItem>
                <SelectItem value='free'>{t('free')}</SelectItem>
                <SelectItem value='paid'>{t('paid')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={filters.certified ? 'certified' : 'all'} onValueChange={handleCertified}>
            <SelectTrigger className={selectCls} aria-label={t('certLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('certAll')}</SelectItem>
                <SelectItem value='certified'>{t('certified')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={filters.sort ?? 'date-desc'} onValueChange={handleSort}>
            <SelectTrigger className={selectCls} aria-label={t('sortLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {sortOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value ?? 'date-desc'}>
                    {t(`sorts.${opt.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <ChevronDown className='h-[15px] w-[15px] text-muted-foreground/40' aria-hidden />
        </div>
      </div>

      {/* 筛选区（移动端）：排序 Tab + 2 列下拉 */}
      <div className='mb-4 lg:hidden'>
        <div className='mb-2 flex items-center gap-1 overflow-x-auto'>
          {sortTabs.map((tab) => (
            <button
              key={tab.key}
              type='button'
              onClick={() => handleTab(tab.key)}
              className={cn(
                'h-[34px] shrink-0 whitespace-nowrap rounded-[8px] px-[12px] font-medium text-[13px] transition-colors duration-150',
                activeTab === tab.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {t(`tabs.${tab.labelKey}`)}
            </button>
          ))}
        </div>
        <div className='grid grid-cols-2 gap-[10px] sm:grid-cols-4'>
          <Select value={filters.categorySlugs?.[0] ?? 'all'} onValueChange={handleCategory}>
            <SelectTrigger className={selectCls} aria-label={t('categoryLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('allCategories')}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={filters.priceType ?? 'all'} onValueChange={handlePrice}>
            <SelectTrigger className={selectCls} aria-label={t('priceLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('allPrices')}</SelectItem>
                <SelectItem value='free'>{t('free')}</SelectItem>
                <SelectItem value='paid'>{t('paid')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={filters.certified ? 'certified' : 'all'} onValueChange={handleCertified}>
            <SelectTrigger className={selectCls} aria-label={t('certLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='all'>{t('certAll')}</SelectItem>
                <SelectItem value='certified'>{t('certified')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={filters.sort ?? 'date-desc'} onValueChange={handleSort}>
            <SelectTrigger className={selectCls} aria-label={t('sortLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {sortOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value ?? 'date-desc'}>
                    {t(`sorts.${opt.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
