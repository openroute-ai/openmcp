'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { ActiveFilters } from '@/components/workflows/active-filters'
import { WorkflowsFilters } from '@/components/workflows/workflows-filters'
import { WorkflowsGrid } from '@/components/workflows/workflows-grid'
import { WorkflowsHero } from '@/components/workflows/workflows-hero'
import { trpc } from '@/lib/trpc/client'

type Filters = {
  search?: string
  categorySlugs?: string[]
  priceType?: 'free' | 'paid'
  complexity?: 'beginner' | 'intermediate' | 'advanced'
  nodeTypes?: string[]
  certified?: boolean
  timePeriod?: '7d' | '1m' | '3m' | 'all'
  sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'popularity-desc'
}

// 从 URL 参数解析过滤条件
function parseFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}

  // 搜索关键词
  const search = searchParams.get('search')
  if (search) filters.search = search

  // 分类（多个值用逗号分隔）
  const categorySlugs = searchParams.get('categorySlugs')
  if (categorySlugs) {
    filters.categorySlugs = categorySlugs.split(',').filter(Boolean)
  }

  // 价格类型
  const priceType = searchParams.get('priceType')
  if (priceType === 'free' || priceType === 'paid') {
    filters.priceType = priceType
  }

  // 复杂度
  const complexity = searchParams.get('complexity')
  if (complexity === 'beginner' || complexity === 'intermediate' || complexity === 'advanced') {
    filters.complexity = complexity
  }

  // 节点类型（多个值用逗号分隔）
  const nodeTypes = searchParams.get('nodeTypes')
  if (nodeTypes) {
    filters.nodeTypes = nodeTypes.split(',').filter(Boolean)
  }

  // 认证状态
  const certified = searchParams.get('certified')
  if (certified === 'true') {
    filters.certified = true
  }

  // 时间段
  const timePeriod = searchParams.get('timePeriod')
  if (timePeriod === '7d' || timePeriod === '1m' || timePeriod === '3m' || timePeriod === 'all') {
    filters.timePeriod = timePeriod
  }

  // 排序
  const sort = searchParams.get('sort')
  if (
    sort === 'date-desc' ||
    sort === 'date-asc' ||
    sort === 'downloads-desc' ||
    sort === 'views-desc' ||
    sort === 'popularity-desc'
  ) {
    filters.sort = sort
  }

  return filters
}

// 将过滤条件转换为 URL 参数
function filtersToURLParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.search) {
    params.set('search', filters.search)
  }

  if (filters.categorySlugs && filters.categorySlugs.length > 0) {
    params.set('categorySlugs', filters.categorySlugs.join(','))
  }

  if (filters.priceType) {
    params.set('priceType', filters.priceType)
  }

  if (filters.complexity) {
    params.set('complexity', filters.complexity)
  }

  if (filters.nodeTypes && filters.nodeTypes.length > 0) {
    params.set('nodeTypes', filters.nodeTypes.join(','))
  }

  if (filters.certified !== undefined) {
    params.set('certified', 'true')
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

function WorkflowsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
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
    return pageParam ? parseInt(pageParam, 10) : 1
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

  // 获取工作流列表
  const { data, isLoading, error } = trpc.workflows.getWorkflows.useQuery({
    page,
    limit,
    search: filters.search,
    categorySlugs: filters.categorySlugs,
    priceType: filters.priceType,
    complexity: filters.complexity,
    nodeTypes: filters.nodeTypes,
    certified: filters.certified,
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
    const newPage = pageParam ? parseInt(pageParam, 10) : 1
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

  const handleSearch = useCallback(
    (search: string) => {
      const updatedFilters = { ...filters, search: search || undefined }
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

  const handleRemoveFilter = useCallback(
    (filterType: string, value?: string) => {
      const updatedFilters = { ...filters }

      switch (filterType) {
        case 'search':
          delete updatedFilters.search
          break
        case 'categorySlugs':
          if (value && updatedFilters.categorySlugs) {
            const newSlugs = updatedFilters.categorySlugs.filter((s) => s !== value)
            updatedFilters.categorySlugs = newSlugs.length > 0 ? newSlugs : undefined
          } else {
            delete updatedFilters.categorySlugs
          }
          break
        case 'priceType':
          delete updatedFilters.priceType
          break
        case 'complexity':
          delete updatedFilters.complexity
          break
        case 'nodeTypes':
          if (value && updatedFilters.nodeTypes) {
            const newTypes = updatedFilters.nodeTypes.filter((t) => t !== value)
            updatedFilters.nodeTypes = newTypes.length > 0 ? newTypes : undefined
          } else {
            delete updatedFilters.nodeTypes
          }
          break
        case 'certified':
          delete updatedFilters.certified
          break
        case 'timePeriod':
          updatedFilters.timePeriod = 'all'
          break
        case 'sort':
          updatedFilters.sort = 'date-desc'
          break
      }

      setFilters(updatedFilters)
      setPage(1)
      updateURL(updatedFilters, 1)
    },
    [filters, updateURL]
  )

  const handleClearAll = useCallback(() => {
    const defaultFilters: Filters = {
      sort: 'date-desc',
      timePeriod: 'all',
    }
    setFilters(defaultFilters)
    setPage(1)
    updateURL(defaultFilters, 1)
  }, [updateURL])

  const workflows = data?.success ? data.data || [] : []
  const pagination = data?.success ? data.pagination : undefined

  return (
    <div className='pt-16'>
      <WorkflowsHero
        onSearch={handleSearch}
        totalWorkflows={pagination?.total || 0}
        initialSearch={filters.search || ''}
      />
      <section className='py-8'>
        <div className='mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10'>
          <div className='flex flex-col gap-8 lg:flex-row'>
            <WorkflowsFilters filters={filters} onFilterChange={handleFilterChange} />
            <div className='flex-1'>
              <ActiveFilters filters={filters} onRemoveFilter={handleRemoveFilter} onClearAll={handleClearAll} />
              <WorkflowsGrid
                workflows={workflows}
                isLoading={isLoading}
                error={error as Error | null}
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

export function WorkflowsPageClient() {
  return (
    <Suspense fallback={null}>
      <WorkflowsPageInner />
    </Suspense>
  )
}
