'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { McpToolsGrid } from '@/components/mcp-tools/mcp-tools-grid'
import { McpToolsHero } from '@/components/mcp-tools/mcp-tools-hero'
import { trpc } from '@/lib/trpc/client'

type Filters = {
  search?: string
  skillId?: string
  sort?: 'date-desc' | 'date-asc' | 'name-asc'
}

function parseFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}
  const search = searchParams.get('search')
  if (search) filters.search = search
  const skillId = searchParams.get('skillId')
  if (skillId) filters.skillId = skillId
  const sort = searchParams.get('sort')
  if (sort === 'date-desc' || sort === 'date-asc' || sort === 'name-asc') filters.sort = sort
  return filters
}

function filtersToURLParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.skillId) params.set('skillId', filters.skillId)
  if (filters.sort && filters.sort !== 'date-desc') params.set('sort', filters.sort)
  if (page > 1) params.set('page', page.toString())
  return params
}

function ToolsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const limit = 18

  const [filters, setFilters] = useState<Filters>(() => ({
    sort: 'date-desc',
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

  const { data, isLoading, error } = trpc.mcpTools.getMcpTools.useQuery({
    page,
    limit,
    search: filters.search,
    skillId: filters.skillId,
    sort: filters.sort,
  })

  useEffect(() => {
    const parsed = parseFiltersFromURL(searchParams)
    setFilters({ sort: parsed.sort || 'date-desc', ...parsed })
    const pageParam = searchParams.get('page')
    setPage(pageParam ? parseInt(pageParam, 10) : 1)
  }, [searchParams])

  const handleSearch = useCallback(
    (search: string) => {
      const updated = { ...filters, search: search || undefined }
      setFilters(updated)
      setPage(1)
      updateURL(updated, 1)
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

  const tools = data?.success ? (data.data ?? []) : []
  const pagination = data?.success ? data.pagination : undefined

  return (
    <div className='pt-16'>
      <McpToolsHero onSearch={handleSearch} totalTools={pagination?.total ?? 0} initialSearch={filters.search ?? ''} />
      <section className='py-8'>
        <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
          <McpToolsGrid
            tools={tools}
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
export function ToolsPageClient() {
  return (
    <Suspense fallback={null}>
      <ToolsPageInner />
    </Suspense>
  )
}
