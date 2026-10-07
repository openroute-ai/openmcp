'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Loader2, X } from 'lucide-react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PersonasGrid } from '@/components/personas/personas-grid'
import { SkillsGrid } from '@/components/skills/skills-grid'
import { AuthorContentTypeFilter, type AuthorView } from '@/components/workflows/author-content-type-filter'
import { AuthorHero } from '@/components/workflows/author-hero'
import { AuthorWorkflowsFilters } from '@/components/workflows/author-workflows-filters'
import { AuthorWorkflowsGrid } from '@/components/workflows/author-workflows-grid'
import { trpc } from '@/lib/trpc/client'

export const dynamic = 'force-dynamic'

type Filters = {
  category?: string
  timePeriod?: string
  price?: string
  sort?: string
}

function parseAuthorView(searchParams: URLSearchParams): AuthorView {
  const raw = searchParams.get('view')
  if (raw === 'skills' || raw === 'workflows' || raw === 'personas') {
    return raw
  }
  return 'skills'
}

function parseWorkflowFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}
  const category = searchParams.get('category')
  if (category) filters.category = category
  const price = searchParams.get('price')
  if (price === 'free' || price === 'paid') {
    filters.price = price
  }
  const timePeriod = searchParams.get('timePeriod')
  if (timePeriod === '7d' || timePeriod === '1m' || timePeriod === '3m' || timePeriod === 'all') {
    filters.timePeriod = timePeriod
  }
  const sort = searchParams.get('sort')
  if (sort === 'date-desc' || sort === 'date-asc' || sort === 'downloads-desc' || sort === 'views-desc') {
    filters.sort = sort
  }
  return filters
}

function parseSkillsFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}
  const category = searchParams.get('sc')
  if (category) filters.category = category
  const price = searchParams.get('spr')
  if (price === 'free' || price === 'paid') {
    filters.price = price
  }
  const timePeriod = searchParams.get('st')
  if (timePeriod === '7d' || timePeriod === '1m' || timePeriod === '3m' || timePeriod === 'all') {
    filters.timePeriod = timePeriod
  }
  const sort = searchParams.get('ss')
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

function parsePersonasFiltersFromURL(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}
  const category = searchParams.get('pc')
  if (category) filters.category = category
  const price = searchParams.get('ppr')
  if (price === 'free' || price === 'paid') {
    filters.price = price
  }
  const timePeriod = searchParams.get('pt')
  if (timePeriod === '7d' || timePeriod === '1m' || timePeriod === '3m' || timePeriod === 'all') {
    filters.timePeriod = timePeriod
  }
  const sort = searchParams.get('ps')
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

function normalizeFilters(parsed: Filters): Filters {
  return {
    sort: parsed.sort || 'date-desc',
    timePeriod: parsed.timePeriod || 'all',
    category: parsed.category,
    price: parsed.price,
  }
}

type AuthorURLState = {
  view: AuthorView
  wf: { page: number; filters: Filters }
  sk: { page: number; filters: Filters }
  pe: { page: number; filters: Filters }
}

function buildAuthorURL(pathname: string, state: AuthorURLState): string {
  const p = new URLSearchParams()
  p.set('view', state.view)

  const wf = state.wf.filters
  if (wf.category) p.set('category', wf.category)
  if (wf.price) p.set('price', wf.price)
  if (wf.timePeriod && wf.timePeriod !== 'all') p.set('timePeriod', wf.timePeriod)
  if (wf.sort && wf.sort !== 'date-desc') p.set('sort', wf.sort)
  if (state.wf.page > 1) p.set('page', String(state.wf.page))

  const sk = state.sk.filters
  if (sk.category) p.set('sc', sk.category)
  if (sk.price) p.set('spr', sk.price)
  if (sk.timePeriod && sk.timePeriod !== 'all') p.set('st', sk.timePeriod)
  if (sk.sort && sk.sort !== 'date-desc') p.set('ss', sk.sort)
  if (state.sk.page > 1) p.set('sp', String(state.sk.page))

  const pe = state.pe.filters
  if (pe.category) p.set('pc', pe.category)
  if (pe.price) p.set('ppr', pe.price)
  if (pe.timePeriod && pe.timePeriod !== 'all') p.set('pt', pe.timePeriod)
  if (pe.sort && pe.sort !== 'date-desc') p.set('ps', pe.sort)
  if (state.pe.page > 1) p.set('pp', String(state.pe.page))

  const qs = p.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

function parsePage(searchParams: URLSearchParams, key: string): number {
  const raw = searchParams.get(key)
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n) || n < 1) return 1
  return n
}

function AuthorPageSkeleton() {
  return (
    <div className='pt-4'>
      <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
        <div className='flex flex-col items-center gap-6 md:flex-row md:items-start'>
          <Skeleton className='h-24 w-24 rounded-full md:h-32 md:w-32' />
          <div className='flex-1 space-y-4 text-center md:text-left'>
            <Skeleton className='h-8 w-48' />
            <Skeleton className='h-6 w-32' />
            <Skeleton className='h-4 w-full max-w-2xl' />
            <Skeleton className='h-4 w-3/4 max-w-2xl' />
            <div className='flex flex-wrap gap-2'>
              <Skeleton className='h-8 w-24' />
              <Skeleton className='h-8 w-24' />
              <Skeleton className='h-8 w-24' />
            </div>
          </div>
        </div>
      </div>

      <section className='py-4'>
        <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
          <div className='flex flex-col gap-8 lg:flex-row'>
            <div className='w-full space-y-4 lg:w-64'>
              <Skeleton className='h-32 w-full rounded-lg' />
              <Skeleton className='h-6 w-24' />
              <Skeleton className='h-10 w-full' />
              <Skeleton className='h-10 w-full' />
            </div>
            <div className='flex-1'>
              <div className='mb-6 flex flex-wrap items-center gap-2'>
                <Skeleton className='h-6 w-24' />
              </div>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`sk-${index}`}
                    className='flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm'
                  >
                    <Skeleton className='aspect-video w-full' />
                    <div className='space-y-2 p-4'>
                      <Skeleton className='h-5 w-full' />
                      <Skeleton className='h-4 w-3/4' />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function AuthorPage() {
  const params = useParams()
  const slug = params.slug as string
  const locale = useLocale() as 'zh' | 'en'
  const t = useTranslations('Workflows')
  const tAuthors = useTranslations('AuthorsPage')
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [view, setView] = useState<AuthorView>(() => parseAuthorView(searchParams))

  const [wfFilters, setWfFilters] = useState<Filters>(() => normalizeFilters(parseWorkflowFiltersFromURL(searchParams)))
  const [wfPage, setWfPage] = useState(() => parsePage(searchParams, 'page'))

  const [skFilters, setSkFilters] = useState<Filters>(() => normalizeFilters(parseSkillsFiltersFromURL(searchParams)))
  const [skPage, setSkPage] = useState(() => parsePage(searchParams, 'sp'))

  const [peFilters, setPeFilters] = useState<Filters>(() => normalizeFilters(parsePersonasFiltersFromURL(searchParams)))
  const [pePage, setPePage] = useState(() => parsePage(searchParams, 'pp'))

  const pushURL = useCallback(
    (next: AuthorURLState) => {
      router.push(buildAuthorURL(pathname, next), { scroll: false })
    },
    [router, pathname]
  )

  const getFullState = useCallback((): AuthorURLState => {
    return {
      view,
      wf: { page: wfPage, filters: wfFilters },
      sk: { page: skPage, filters: skFilters },
      pe: { page: pePage, filters: peFilters },
    }
  }, [view, wfPage, wfFilters, skPage, skFilters, pePage, peFilters])

  useEffect(() => {
    setView(parseAuthorView(searchParams))
    setWfFilters(normalizeFilters(parseWorkflowFiltersFromURL(searchParams)))
    setWfPage(parsePage(searchParams, 'page'))
    setSkFilters(normalizeFilters(parseSkillsFiltersFromURL(searchParams)))
    setSkPage(parsePage(searchParams, 'sp'))
    setPeFilters(normalizeFilters(parsePersonasFiltersFromURL(searchParams)))
    setPePage(parsePage(searchParams, 'pp'))
  }, [searchParams])

  useEffect(() => {
    if (searchParams.has('view')) return
    const state: AuthorURLState = {
      view: 'skills',
      wf: {
        page: parsePage(searchParams, 'page'),
        filters: normalizeFilters(parseWorkflowFiltersFromURL(searchParams)),
      },
      sk: {
        page: parsePage(searchParams, 'sp'),
        filters: normalizeFilters(parseSkillsFiltersFromURL(searchParams)),
      },
      pe: {
        page: parsePage(searchParams, 'pp'),
        filters: normalizeFilters(parsePersonasFiltersFromURL(searchParams)),
      },
    }
    router.replace(buildAuthorURL(pathname, state), { scroll: false })
  }, [searchParams, pathname, router])

  const handleWfFilterChange = useCallback(
    (newFilters: Filters) => {
      const updated = normalizeFilters(newFilters)
      setWfFilters(updated)
      setWfPage(1)
      pushURL({
        ...getFullState(),
        wf: { page: 1, filters: updated },
      })
    },
    [getFullState, pushURL]
  )

  const handleSkFilterChange = useCallback(
    (newFilters: Filters) => {
      const updated = normalizeFilters(newFilters)
      setSkFilters(updated)
      setSkPage(1)
      pushURL({
        ...getFullState(),
        sk: { page: 1, filters: updated },
      })
    },
    [getFullState, pushURL]
  )

  const handlePeFilterChange = useCallback(
    (newFilters: Filters) => {
      const updated = normalizeFilters(newFilters)
      setPeFilters(updated)
      setPePage(1)
      pushURL({
        ...getFullState(),
        pe: { page: 1, filters: updated },
      })
    },
    [getFullState, pushURL]
  )

  const { data: authorData, isLoading: authorLoading } = trpc.authors.getAuthorBySlug.useQuery({
    slug,
  })

  const { data: categoriesData } = trpc.authors.getAuthorWorkflowCategories.useQuery(
    { authorSlug: slug },
    { enabled: !authorLoading && !!authorData?.success && !!authorData.data && view === 'workflows' }
  )

  const { data: skillCategoriesData } = trpc.authors.getAuthorSkillCategories.useQuery(
    { authorSlug: slug },
    { enabled: !authorLoading && !!authorData?.success && !!authorData.data && view === 'skills' }
  )

  const { data: personaCategoriesData } = trpc.authors.getAuthorPersonaCategories.useQuery(
    { authorSlug: slug },
    { enabled: !authorLoading && !!authorData?.success && !!authorData.data && view === 'personas' }
  )

  const { data: workflowsData, isLoading: workflowsLoading } = trpc.authors.getAuthorWorkflows.useQuery(
    {
      authorSlug: slug,
      page: wfPage,
      limit: 18,
      categorySlugs: wfFilters.category ? [wfFilters.category] : undefined,
      priceType: wfFilters.price === 'free' ? 'free' : wfFilters.price === 'paid' ? 'paid' : undefined,
      timePeriod: wfFilters.timePeriod as '7d' | '1m' | '3m' | 'all' | undefined,
      sort: wfFilters.sort as 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | undefined,
    },
    {
      enabled: !authorLoading && !!authorData?.success && !!authorData.data && view === 'workflows',
    }
  )

  const { data: skillsData, isLoading: skillsLoading } = trpc.skills.getSkills.useQuery(
    {
      page: skPage,
      limit: 18,
      authorUsername: slug,
      categorySlugs: skFilters.category ? [skFilters.category] : undefined,
      priceType: skFilters.price === 'free' ? 'free' : skFilters.price === 'paid' ? 'paid' : undefined,
      timePeriod: skFilters.timePeriod as '7d' | '1m' | '3m' | 'all' | undefined,
      sort: skFilters.sort as
        | 'date-desc'
        | 'date-asc'
        | 'downloads-desc'
        | 'views-desc'
        | 'popularity-desc'
        | undefined,
    },
    {
      enabled: !authorLoading && !!authorData?.success && !!authorData.data && view === 'skills',
    }
  )

  const { data: personasData, isLoading: personasLoading } = trpc.personas.getPersonas.useQuery(
    {
      page: pePage,
      limit: 18,
      authorUsername: slug,
      categorySlugs: peFilters.category ? [peFilters.category] : undefined,
      priceType: peFilters.price === 'free' ? 'free' : peFilters.price === 'paid' ? 'paid' : undefined,
      timePeriod: peFilters.timePeriod as '7d' | '1m' | '3m' | 'all' | undefined,
      sort: peFilters.sort as 'date-desc' | 'date-asc' | 'downloads-desc' | 'views-desc' | 'likes-desc' | undefined,
    },
    {
      enabled: !authorLoading && !!authorData?.success && !!authorData.data && view === 'personas',
    }
  )

  const [cachedWorkflows, setCachedWorkflows] = useState<
    Array<{
      id: string
      referenceId: string | null
      slug: string
      title: string | null
      titleEn: string | null
      description: string | null
      descriptionEn: string | null
      summary: string | null
      imageUrl: string | null
      priceType: string
      priceAmount: string | null
      complexity: string | null
      certified: boolean
      views: number
      downloads: number
      likes: number
      publishedAt: Date | null
      createdAt: Date
    }>
  >([])

  useEffect(() => {
    if (!workflowsLoading && workflowsData?.success && workflowsData.data) {
      setCachedWorkflows(workflowsData.data)
    }
  }, [workflowsLoading, workflowsData])

  const availableWfCategories = useMemo(() => {
    if (!categoriesData?.success || !categoriesData.data) return []
    const localeStr = locale === 'zh' ? 'name' : 'nameEn'
    return categoriesData.data.map((cat) => ({
      value: cat.slug,
      label: cat[localeStr],
      count: 0,
    }))
  }, [categoriesData, locale])

  const availableSkCategories = useMemo(() => {
    if (!skillCategoriesData?.success || !skillCategoriesData.data) return []
    const localeStr = locale === 'zh' ? 'name' : 'nameEn'
    return skillCategoriesData.data.map((cat) => ({
      value: cat.slug,
      label: cat[localeStr],
      count: 0,
    }))
  }, [skillCategoriesData, locale])

  const availablePeCategories = useMemo(() => {
    if (!personaCategoriesData?.success || !personaCategoriesData.data) return []
    const localeStr = locale === 'zh' ? 'name' : 'nameEn'
    return personaCategoriesData.data.map((cat) => ({
      value: cat.slug,
      label: cat[localeStr],
      count: 0,
    }))
  }, [personaCategoriesData, locale])

  const wfCategoryMap = useMemo(() => {
    if (!categoriesData?.success || !categoriesData.data) return new Map<string, string>()
    const localeStr = locale === 'zh' ? 'name' : 'nameEn'
    return new Map(categoriesData.data.map((cat) => [cat.slug, cat[localeStr]]))
  }, [categoriesData, locale])

  const skCategoryMap = useMemo(() => {
    if (!skillCategoriesData?.success || !skillCategoriesData.data) return new Map<string, string>()
    const localeStr = locale === 'zh' ? 'name' : 'nameEn'
    return new Map(skillCategoriesData.data.map((cat) => [cat.slug, cat[localeStr]]))
  }, [skillCategoriesData, locale])

  const peCategoryMap = useMemo(() => {
    if (!personaCategoriesData?.success || !personaCategoriesData.data) return new Map<string, string>()
    const localeStr = locale === 'zh' ? 'name' : 'nameEn'
    return new Map(personaCategoriesData.data.map((cat) => [cat.slug, cat[localeStr]]))
  }, [personaCategoriesData, locale])

  const wfActiveFilters = useMemo(() => {
    const active: Array<{ type: string; label: string }> = []
    const filters = wfFilters
    if (filters.category) {
      active.push({ type: 'category', label: wfCategoryMap.get(filters.category) || filters.category })
    }
    if (filters.price) {
      const priceLabels: Record<string, string> = {
        free: t('Authors.price.free'),
        paid: t('Authors.price.paid'),
      }
      active.push({ type: 'price', label: priceLabels[filters.price] || filters.price })
    }
    if (filters.timePeriod && filters.timePeriod !== 'all') {
      const timePeriodLabels: Record<string, string> = {
        '7d': t('Authors.periods.7d'),
        '1m': t('Authors.periods.1m'),
        '3m': t('Authors.periods.3m'),
      }
      active.push({ type: 'timePeriod', label: timePeriodLabels[filters.timePeriod] || filters.timePeriod })
    }
    if (filters.sort && filters.sort !== 'date-desc') {
      const sortLabels: Record<string, string> = {
        'date-asc': t('Authors.sorts.dateAsc'),
        'downloads-desc': t('Authors.sorts.downloadsDesc'),
        'views-desc': t('Authors.sorts.viewsDesc'),
      }
      active.push({
        type: 'sort',
        label: t('Authors.sortPrefix', { value: sortLabels[filters.sort] || filters.sort }),
      })
    }
    return active
  }, [wfFilters, wfCategoryMap, locale])

  const skActiveFilters = useMemo(() => {
    const active: Array<{ type: string; label: string }> = []
    const filters = skFilters
    if (filters.category) {
      active.push({ type: 'category', label: skCategoryMap.get(filters.category) || filters.category })
    }
    if (filters.price) {
      const priceLabels: Record<string, string> = {
        free: t('Authors.price.free'),
        paid: t('Authors.price.paid'),
      }
      active.push({ type: 'price', label: priceLabels[filters.price] || filters.price })
    }
    if (filters.timePeriod && filters.timePeriod !== 'all') {
      const timePeriodLabels: Record<string, string> = {
        '7d': t('Authors.periods.7d'),
        '1m': t('Authors.periods.1m'),
        '3m': t('Authors.periods.3m'),
      }
      active.push({ type: 'timePeriod', label: timePeriodLabels[filters.timePeriod] || filters.timePeriod })
    }
    if (filters.sort && filters.sort !== 'date-desc') {
      const sortLabels: Record<string, string> = {
        'date-asc': t('Authors.sorts.dateAsc'),
        'downloads-desc': t('Authors.sorts.downloadsDesc'),
        'views-desc': t('Authors.sorts.viewsDesc'),
        'popularity-desc': t('Authors.sorts.popularityDesc'),
      }
      active.push({
        type: 'sort',
        label: t('Authors.sortPrefix', { value: sortLabels[filters.sort] || filters.sort }),
      })
    }
    return active
  }, [skFilters, skCategoryMap, locale])

  const peActiveFilters = useMemo(() => {
    const active: Array<{ type: string; label: string }> = []
    const filters = peFilters
    if (filters.category) {
      active.push({ type: 'category', label: peCategoryMap.get(filters.category) || filters.category })
    }
    if (filters.price) {
      const priceLabels: Record<string, string> = {
        free: t('Authors.price.free'),
        paid: t('Authors.price.paid'),
      }
      active.push({ type: 'price', label: priceLabels[filters.price] || filters.price })
    }
    if (filters.timePeriod && filters.timePeriod !== 'all') {
      const timePeriodLabels: Record<string, string> = {
        '7d': t('Authors.periods.7d'),
        '1m': t('Authors.periods.1m'),
        '3m': t('Authors.periods.3m'),
      }
      active.push({ type: 'timePeriod', label: timePeriodLabels[filters.timePeriod] || filters.timePeriod })
    }
    if (filters.sort && filters.sort !== 'date-desc') {
      const sortLabels: Record<string, string> = {
        'date-asc': t('Authors.sorts.dateAsc'),
        'downloads-desc': t('Authors.sorts.downloadsDesc'),
        'views-desc': t('Authors.sorts.viewsDesc'),
        'likes-desc': t('Authors.sorts.likesDesc'),
      }
      active.push({
        type: 'sort',
        label: t('Authors.sortPrefix', { value: sortLabels[filters.sort] || filters.sort }),
      })
    }
    return active
  }, [peFilters, peCategoryMap, locale])

  const removeWfFilter = useCallback(
    (filterType: string) => {
      const updated = { ...wfFilters }
      switch (filterType) {
        case 'category':
          delete updated.category
          break
        case 'price':
          delete updated.price
          break
        case 'timePeriod':
          updated.timePeriod = 'all'
          break
        case 'sort':
          updated.sort = 'date-desc'
          break
        default:
          break
      }
      const final = normalizeFilters(updated)
      setWfFilters(final)
      setWfPage(1)
      pushURL({ ...getFullState(), wf: { page: 1, filters: final } })
    },
    [wfFilters, getFullState, pushURL]
  )

  const removeSkFilter = useCallback(
    (filterType: string) => {
      const updated = { ...skFilters }
      switch (filterType) {
        case 'category':
          delete updated.category
          break
        case 'price':
          delete updated.price
          break
        case 'timePeriod':
          updated.timePeriod = 'all'
          break
        case 'sort':
          updated.sort = 'date-desc'
          break
        default:
          break
      }
      const final = normalizeFilters(updated)
      setSkFilters(final)
      setSkPage(1)
      pushURL({ ...getFullState(), sk: { page: 1, filters: final } })
    },
    [skFilters, getFullState, pushURL]
  )

  const removePeFilter = useCallback(
    (filterType: string) => {
      const updated = { ...peFilters }
      switch (filterType) {
        case 'category':
          delete updated.category
          break
        case 'price':
          delete updated.price
          break
        case 'timePeriod':
          updated.timePeriod = 'all'
          break
        case 'sort':
          updated.sort = 'date-desc'
          break
        default:
          break
      }
      const final = normalizeFilters(updated)
      setPeFilters(final)
      setPePage(1)
      pushURL({ ...getFullState(), pe: { page: 1, filters: final } })
    },
    [peFilters, getFullState, pushURL]
  )

  const clearWfFilters = useCallback(() => {
    const def = normalizeFilters({})
    setWfFilters(def)
    setWfPage(1)
    pushURL({ ...getFullState(), wf: { page: 1, filters: def } })
  }, [getFullState, pushURL])

  const clearSkFilters = useCallback(() => {
    const def = normalizeFilters({})
    setSkFilters(def)
    setSkPage(1)
    pushURL({ ...getFullState(), sk: { page: 1, filters: def } })
  }, [getFullState, pushURL])

  const clearPeFilters = useCallback(() => {
    const def = normalizeFilters({})
    setPeFilters(def)
    setPePage(1)
    pushURL({ ...getFullState(), pe: { page: 1, filters: def } })
  }, [getFullState, pushURL])

  if (authorLoading) {
    return <AuthorPageSkeleton />
  }

  if (!authorLoading && (!authorData?.success || !authorData.data)) {
    return (
      <div className='mx-auto w-full max-w-7xl px-5 py-12 sm:px-6 lg:px-10'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>{tAuthors('notFound.title')}</h1>
          <p className='text-muted-foreground'>{tAuthors('notFound.description')}</p>
        </div>
      </div>
    )
  }

  if (!authorData?.success || !authorData.data) {
    return null
  }

  const author = authorData.data

  const workflows = workflowsLoading
    ? cachedWorkflows
    : workflowsData?.success
      ? workflowsData.data || []
      : cachedWorkflows

  const formattedWorkflows = workflows.map((w) => {
    const title = locale === 'zh' ? w.title || w.titleEn || '' : w.titleEn || w.title || ''
    const description =
      locale === 'zh' ? w.description || w.descriptionEn || '' : w.descriptionEn || w.description || ''
    // Keep the raw level alongside the localized label: the card picks its
    // badge colour from the key, not from the translated text.
    const complexityKey: 'beginner' | 'intermediate' | 'advanced' =
      w.complexity === 'beginner' ? 'beginner' : w.complexity === 'advanced' ? 'advanced' : 'intermediate'
    const complexity = t(`complexity.${complexityKey}`)
    let price = w.priceType
    if (w.priceType === 'free') {
      price = t('priceType.free')
    } else if (w.priceType === 'paid') {
      price = t('priceType.paid')
    }
    return {
      id: w.id,
      workflowId: w.id,
      slug: w.slug,
      title,
      description: description || '',
      author: author.name,
      imageUrl: w.imageUrl || '/assets/svg/placeholder-workflow.svg',
      categories: [],
      complexity,
      complexityKey,
      price,
      views: w.views,
      downloads: w.downloads,
      date: w.publishedAt?.toISOString().split('T')[0] || w.createdAt.toISOString().split('T')[0] || '',
      certified: w.certified,
    }
  })

  const formattedAuthor = {
    id: author.id,
    name: author.name,
    username: author.username,
    avatar: author.avatar,
    description: author.description ?? undefined,
    website: author.website ?? undefined,
    workflowCount: author.workflowCount,
    skillCount: author.skillCount,
    personaCount: author.personaCount,
    verified: author.verified,
    hasLinks: !!(author.website || author.twitter || author.linkedin || author.github),
  }

  const skillsList = skillsData?.success && skillsData.data ? skillsData.data : []
  const personasList = personasData?.success && personasData.data ? personasData.data : []

  const onViewChange = (next: AuthorView) => {
    setView(next)
    pushURL({
      ...getFullState(),
      view: next,
    })
  }

  const renderActiveBadges = (
    active: Array<{ type: string; label: string }>,
    loading: boolean,
    onRemove: (type: string) => void,
    onClearAll: () => void
  ) => (
    <div className='mb-6 flex flex-wrap items-center gap-2'>
      {loading && (
        <div className='flex items-center gap-2'>
          <Loader2 className='h-4 w-4 animate-spin text-primary' />
          <span className='text-muted-foreground text-sm'>{t('Authors.loading')}</span>
        </div>
      )}
      {!loading && active.length > 0 && (
        <>
          <span className='font-medium text-muted-foreground text-sm'>
            {t('Authors.activeFilters')}
          </span>
          {active.map((filter, index) => (
            <Badge
              key={`${filter.type}-${index}`}
              variant='secondary'
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm'
            >
              <span>{filter.label}</span>
              <button
                type='button'
                onClick={() => onRemove(filter.type)}
                className='ml-1 rounded-full p-0.5 transition-colors hover:bg-muted'
                aria-label={t('Authors.removeFilter', { label: filter.label })}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}
          {active.length > 1 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={onClearAll}
              className='h-7 text-muted-foreground text-xs hover:text-foreground'
            >
              {t('Authors.clearAll')}
            </Button>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className='pt-4'>
      <AuthorHero author={formattedAuthor} />
      <section className='py-4'>
        <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
          <div className='flex flex-col gap-8 lg:flex-row'>
            <div className='w-full shrink-0 space-y-6 lg:w-64'>
              <AuthorContentTypeFilter value={view} onChange={onViewChange} />
              {view === 'skills' ? (
                <AuthorWorkflowsFilters
                  filters={skFilters}
                  onFilterChange={handleSkFilterChange}
                  availableCategories={availableSkCategories}
                  sortVariant='skill'
                />
              ) : null}
              {view === 'workflows' ? (
                <AuthorWorkflowsFilters
                  filters={wfFilters}
                  onFilterChange={handleWfFilterChange}
                  availableCategories={availableWfCategories}
                  sortVariant='workflow'
                />
              ) : null}
              {view === 'personas' ? (
                <AuthorWorkflowsFilters
                  filters={peFilters}
                  onFilterChange={handlePeFilterChange}
                  availableCategories={availablePeCategories}
                  sortVariant='persona'
                />
              ) : null}
            </div>
            <div className='min-w-0 flex-1'>
              {view === 'skills' ? (
                <>
                  {renderActiveBadges(skActiveFilters, skillsLoading, removeSkFilter, clearSkFilters)}
                  <SkillsGrid
                    skills={skillsList}
                    isLoading={skillsLoading}
                    pagination={skillsData?.success ? skillsData.pagination : undefined}
                    onPageChange={(newPage) => {
                      setSkPage(newPage)
                      pushURL({ ...getFullState(), sk: { page: newPage, filters: skFilters } })
                    }}
                  />
                </>
              ) : null}
              {view === 'workflows' ? (
                <>
                  {renderActiveBadges(wfActiveFilters, workflowsLoading, removeWfFilter, clearWfFilters)}
                  <AuthorWorkflowsGrid
                    workflows={formattedWorkflows}
                    filters={wfFilters}
                    loading={workflowsLoading}
                    pagination={workflowsData?.success ? workflowsData.pagination : undefined}
                    onPageChange={(newPage) => {
                      setWfPage(newPage)
                      pushURL({ ...getFullState(), wf: { page: newPage, filters: wfFilters } })
                    }}
                  />
                </>
              ) : null}
              {view === 'personas' ? (
                <>
                  {renderActiveBadges(peActiveFilters, personasLoading, removePeFilter, clearPeFilters)}
                  <PersonasGrid
                    personas={personasList}
                    isLoading={personasLoading}
                    pagination={personasData?.success ? personasData.pagination : undefined}
                    onPageChange={(newPage) => {
                      setPePage(newPage)
                      pushURL({ ...getFullState(), pe: { page: newPage, filters: peFilters } })
                    }}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
