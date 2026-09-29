'use client'

import { Loader2 } from 'lucide-react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { CategoryHero } from '@/components/workflows/category-hero'
import { CategoryWorkflowsFilters } from '@/components/workflows/category-workflows-filters'
import { WorkflowsGrid } from '@/components/workflows/workflows-grid'
import { trpc } from '@/lib/trpc/client'

type Filters = {
  timePeriod?: '7d' | '1m' | '3m' | 'all'
  price?: 'free' | 'paid'
  sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc'
}

// 从 URL 参数解析过滤条件
function parseFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}

  // 价格类型
  const priceType = searchParams.get('priceType')
  if (priceType === 'free' || priceType === 'paid') {
    filters.price = priceType
  }

  // 时间段
  const timePeriod = searchParams.get('timePeriod')
  if (timePeriod === '7d' || timePeriod === '1m' || timePeriod === '3m' || timePeriod === 'all') {
    filters.timePeriod = timePeriod
  }

  // 排序
  const sort = searchParams.get('sort')
  if (sort === 'date-desc' || sort === 'date-asc' || sort === 'downloads-desc' || sort === 'views-desc') {
    filters.sort = sort
  }

  return filters
}

// 将过滤条件转换为 URL 参数
function filtersToURLParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.price) {
    params.set('priceType', filters.price)
  }

  if (filters.timePeriod && filters.timePeriod !== 'all') {
    params.set('timePeriod', filters.timePeriod)
  }

  if (filters.sort && filters.sort !== 'date-desc') {
    params.set('sort', filters.sort)
  }

  if (page > 1) {
    params.set('page', page.toString())
  }

  return params
}

function CategoryPageInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const slug = decodeURIComponent(params.slug as string)
  const locale = useLocale() as 'zh' | 'en'
  const tCategories = useTranslations('CategoriesPage')
  const limit = 18

  // 从 URL 初始化过滤条件和页码
  const [filters, setFilters] = useState<Filters>(() => {
    const parsed = parseFiltersFromURL(searchParams)
    return {
      sort: parsed.sort || 'date-desc',
      timePeriod: parsed.timePeriod || 'all',
      ...parsed,
    }
  })

  const [page, setPage] = useState(() => {
    const pageParam = searchParams.get('page')
    return pageParam ? Number.parseInt(pageParam, 10) : 1
  })

  // 更新 URL 参数
  const updateURL = useCallback(
    (newFilters: Filters, newPage: number) => {
      const params = filtersToURLParams(newFilters, newPage)
      const newURL = params.toString() ? `${pathname}?${params.toString()}` : pathname
      router.push(newURL, { scroll: false })
    },
    [router, pathname]
  )

  // 获取分类详情
  const { data: categoryData, isLoading: categoryLoading } = trpc.categories.getCategoryBySlug.useQuery({
    slug,
  })

  // 获取工作流列表
  const { data: workflowsData, isLoading: workflowsLoading } = trpc.categories.getCategoryWorkflows.useQuery({
    categorySlug: slug,
    page,
    limit,
    priceType: filters.price,
    timePeriod: filters.timePeriod,
    sort: filters.sort,
  })

  // 当 URL 参数变化时，同步到状态（用于浏览器前进/后退）
  useEffect(() => {
    const parsed = parseFiltersFromURL(searchParams)
    const newFilters: Filters = {
      sort: parsed.sort || 'date-desc',
      timePeriod: parsed.timePeriod || 'all',
      ...parsed,
    }
    setFilters(newFilters)

    const pageParam = searchParams.get('page')
    const newPage = pageParam ? Number.parseInt(pageParam, 10) : 1
    setPage(newPage)
  }, [searchParams])

  const handleFilterChange = useCallback(
    (newFilters: Partial<Filters>) => {
      const updatedFilters = { ...filters, ...newFilters }
      setFilters(updatedFilters)
      setPage(1)
      updateURL(updatedFilters, 1)
    },
    [filters, updateURL]
  )

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage)
      updateURL(filters, newPage)
    },
    [filters, updateURL]
  )

  // 只在首次加载分类详情时显示全屏 loading
  if (categoryLoading) {
    return (
      <div className='mx-auto w-full max-w-page px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='flex min-h-[400px] items-center justify-center'>
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
        </div>
      </div>
    )
  }

  if (!categoryData?.success || !categoryData.data) {
    return (
      <div className='mx-auto w-full max-w-page px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>{tCategories('notFound.title')}</h1>
          <p className='text-muted-foreground'>{tCategories('notFound.description')}</p>
        </div>
      </div>
    )
  }

  const category = categoryData.data
  const workflows = workflowsData?.success ? workflowsData.data || [] : []
  const pagination = workflowsData?.success ? workflowsData.pagination : undefined

  return (
    <div className='pt-4'>
      <CategoryHero category={{ ...category, description: category.description ?? undefined }} />
      <section className='py-4'>
        <div className='mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
          <div className='flex flex-col gap-8 lg:flex-row'>
            <CategoryWorkflowsFilters
              initialFilters={{
                timePeriod: filters.timePeriod === 'all' ? undefined : filters.timePeriod,
                price: filters.price,
                sort: filters.sort,
              }}
              onFilterChange={(newFilters) => {
                handleFilterChange({
                  price: newFilters.price === 'free' ? 'free' : newFilters.price === 'paid' ? 'paid' : undefined,
                  timePeriod: newFilters.timePeriod ? (newFilters.timePeriod as '7d' | '1m' | '3m' | 'all') : 'all',
                  sort: newFilters.sort as 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | undefined,
                })
              }}
            />
            <div className='flex-1'>
              <WorkflowsGrid
                workflows={workflows}
                isLoading={workflowsLoading}
                pagination={pagination}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export function CategoryPageClient() {
  return (
    <Suspense fallback={null}>
      <CategoryPageInner />
    </Suspense>
  )
}
