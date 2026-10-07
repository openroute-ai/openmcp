'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { PersonasGrid } from '@/components/personas/personas-grid'
import { PersonasHero } from '@/components/personas/personas-hero'
import { trpc } from '@/lib/trpc/client'

type Filters = {
  search?: string
  categorySlugs?: string[]
  priceType?: 'free' | 'paid'
  certified?: boolean
  timePeriod?: '7d' | '1m' | '3m' | 'all'
  sort?: 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'likes-desc'
}

function parseFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}
  const search = searchParams.get('search')
  if (search) filters.search = search
  const categorySlugs = searchParams.get('categorySlugs')
  if (categorySlugs) {
    filters.categorySlugs = categorySlugs.split(',').filter(Boolean)
  }
  const priceType = searchParams.get('priceType')
  if (priceType === 'free' || priceType === 'paid') filters.priceType = priceType
  const certified = searchParams.get('certified')
  if (certified === 'true') filters.certified = true
  const timePeriod = searchParams.get('timePeriod')
  if (timePeriod === '7d' || timePeriod === '1m' || timePeriod === '3m' || timePeriod === 'all') {
    filters.timePeriod = timePeriod
  }
  const sort = searchParams.get('sort')
  if (
    sort === 'date-desc' ||
    sort === 'date-asc' ||
    sort === 'downloads-desc' ||
    sort === 'views-desc' ||
    sort === 'likes-desc'
  ) {
    filters.sort = sort
  }
  return filters
}

function filtersToURLParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.categorySlugs?.length) params.set('categorySlugs', filters.categorySlugs.join(','))
  if (filters.priceType) params.set('priceType', filters.priceType)
  if (filters.certified !== undefined) params.set('certified', 'true')
  if (filters.timePeriod && filters.timePeriod !== 'all') params.set('timePeriod', filters.timePeriod)
  if (filters.sort && filters.sort !== 'date-desc') params.set('sort', filters.sort)
  if (page > 1) params.set('page', page.toString())
  return params
}

function PersonasPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const limit = 18

  const [filters, setFilters] = useState<Filters>(() => ({
    sort: 'date-desc',
    timePeriod: 'all',
    ...parseFiltersFromURL(searchParams),
  }))

  const [page, setPage] = useState(() => {
    const pageParam = searchParams.get('page')
    return pageParam ? parseInt(pageParam, 10) : 1
  })

  const updateURL = useCallback(
    (newFilters: Filters, newPage: number) => {
      const params = filtersToURLParams(newFilters, newPage)
      const newURL = params.toString() ? `${pathname}?${params.toString()}` : pathname
      router.push(newURL, { scroll: false })
    },
    [router, pathname]
  )

  const { data, isLoading, error } = trpc.personas.getPersonas.useQuery({
    page,
    limit,
    search: filters.search,
    categorySlugs: filters.categorySlugs,
    priceType: filters.priceType,
    certified: filters.certified,
    timePeriod: filters.timePeriod,
    sort: filters.sort,
  })

  useEffect(() => {
    const parsed = parseFiltersFromURL(searchParams)
    setFilters({ sort: parsed.sort || 'date-desc', timePeriod: parsed.timePeriod || 'all', ...parsed })
    const pageParam = searchParams.get('page')
    setPage(pageParam ? parseInt(pageParam, 10) : 1)
  }, [searchParams])

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage)
      updateURL(filters, newPage)
    },
    [filters, updateURL]
  )

  const personas = data?.success ? (data.data ?? []) : []
  const pagination = data?.success ? data.pagination : undefined

  return (
    <div>
      <PersonasHero totalPersonas={pagination?.total ?? 0} />
      <section className='py-8'>
        <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
          <PersonasGrid
            personas={personas}
            isLoading={isLoading}
            error={error as Error | null}
            pagination={pagination}
            onPageChange={handlePageChange}
          />
        </div>
      </section>
    </div>
  )
}

export function PersonasPageClient() {
  return (
    <Suspense fallback={null}>
      <PersonasPageInner />
    </Suspense>
  )
}
