'use client'

import { Button } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ChevronLeft, ChevronRight, Rocket, Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { A2aAgentCard, type A2aAgentCardData } from '@/components/a2a-agents/a2a-agent-card'
import { A2aAgentsHero } from '@/components/a2a-agents/a2a-agents-hero'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'

const PAGE_SIZE = 18

type Filters = {
  search?: string
  authType?: 'none' | 'bearer' | 'api_key' | 'basic' | 'oauth2' | 'platform_oauth' | 'custom'
  sort?: 'date-desc' | 'downloads-desc' | 'views-desc'
}

const AUTH_TYPES = ['none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'] as const
const SORTS = ['date-desc', 'downloads-desc', 'views-desc'] as const

function toParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.authType) params.set('authType', filters.authType)
  if (filters.sort && filters.sort !== 'date-desc') params.set('sort', filters.sort)
  if (page > 1) params.set('page', String(page))
  return params
}

export interface A2aMarketPageClientProps {
  initialSearch: string
  initialAuthType: string
  initialSort: string
  initialPage: string
}

type A2aAgentRow = {
  id: string
  name: string
  description: string | null
  descriptionEn: string | null
  authType: string | null
  protocolVersion: string | null
  priceType: string
  billingModel: string | null
  unitPrice: string | null
  currency: string
  downloads: number
  certified: boolean
  category: { name: string; nameEn: string } | null
}

export function A2aMarketPageClient(props: A2aMarketPageClientProps) {
  const { initialSearch, initialAuthType, initialSort, initialPage } = props
  const t = useTranslations('A2APage')
  const router = useRouter()
  const pathname = usePathname()
  // `registry-labels` only branches on zh/en, so normalize the BCP-47 tag.
  const lang = useLocale() === 'zh' ? 'zh' : 'en'

  // The server page parses the query string, so these props already match the
  // URL. Reading them as props (instead of mirroring them into state) keeps
  // back/forward navigation in sync without a setState-in-effect loop.
  const filters: Filters = useMemo(
    () => ({
      search: initialSearch || undefined,
      authType: AUTH_TYPES.find((v) => v === initialAuthType),
      sort: SORTS.find((v) => v === initialSort),
    }),
    [initialSearch, initialAuthType, initialSort]
  )
  const page = Math.max(1, parseInt(initialPage, 10) || 1)

  const updateURL = useCallback(
    (nextFilters: Filters, nextPage: number) => {
      const query = toParams(nextFilters, nextPage).toString()
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [router, pathname]
  )

  const { data, isLoading } = trpc.a2aAgents.getAgents.useQuery(
    { page, limit: PAGE_SIZE, search: filters.search, authType: filters.authType, sort: filters.sort },
    { retry: false }
  )

  const handleSearch = useCallback(
    (search: string) => {
      updateURL({ ...filters, search: search || undefined }, 1)
    },
    [filters, updateURL]
  )

  const handlePageChange = useCallback(
    (nextPage: number) => {
      updateURL(filters, nextPage)
    },
    [filters, updateURL]
  )

  const rows: A2aAgentRow[] = data?.success ? (data.data ?? []) : []
  const pagination = data?.success ? data.pagination : undefined
  const failed = data ? !data.success : false

  const cards: A2aAgentCardData[] = rows.map((row) => {
    const paid = row.priceType === 'paid'
    const amount = row.unitPrice ?? '--'
    const priceLabel = !paid
      ? t('price.free')
      : row.billingModel === 'pay_per_call'
        ? t('price.payPerCall', { amount })
        : row.billingModel === 'subscription'
          ? t('price.subscription', { amount })
          : t('price.oneTime', { amount })

    return {
      id: row.id,
      name: row.name,
      description:
        (lang === 'zh' ? row.description || row.descriptionEn : row.descriptionEn || row.description) ?? '',
      authType: row.authType,
      protocolVersion: row.protocolVersion,
      categoryName: row.category
        ? lang === 'zh'
          ? row.category.name
          : row.category.nameEn || row.category.name
        : null,
      price: { paid, label: priceLabel },
      downloads: row.downloads,
      certified: row.certified,
    }
  })

  return (
    <div className='pt-16'>
      <A2aAgentsHero
        onSearch={handleSearch}
        totalAgents={pagination?.total ?? 0}
        initialSearch={filters.search ?? ''}
      />
      <section className='pb-16'>
        <div className='mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10'>
          {isLoading ? (
            <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-48 rounded-lg' />
              ))}
            </div>
          ) : failed ? (
            <div className='py-12 text-center text-muted-foreground'>{t('list.loadError')}</div>
          ) : cards.length === 0 ? (
            <A2aEmptyState searching={!!filters.search} />
          ) : (
            <>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
                {cards.map((agent) => (
                  <A2aAgentCard key={agent.id} agent={agent} />
                ))}
              </div>
              {pagination && pagination.totalPages > 1 && (
                <div className='flex items-center justify-center gap-4 pt-8'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    <ChevronLeft className='mr-1 h-4 w-4' /> {t('list.prev')}
                  </Button>
                  <span className='text-muted-foreground text-sm'>
                    {t('list.pageOf', { page: pagination.page, total: pagination.totalPages })}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => handlePageChange(pagination.page + 1)}
                  >
                    {t('list.next')} <ChevronRight className='ml-1 h-4 w-4' />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function A2aEmptyState({ searching }: { searching: boolean }) {
  const t = useTranslations('A2APage.list')

  return (
    <div className='flex flex-col items-center gap-4 py-16 text-center'>
      <Search className='size-8 text-muted-foreground opacity-0' />
      {searching ? (
        <>
          <p className='text-foreground text-lg'>{t('emptySearchTitle')}</p>
          <p className='text-muted-foreground'>{t('emptySearchHint')}</p>
        </>
      ) : (
        <>
          <p className='text-foreground text-lg'>{t('emptyTitle')}</p>
          <p className='text-muted-foreground'>{t('emptyHint')}</p>
        </>
      )}
      <LocaleLink href={Routes.A2ASubmit}>
        <Button type='button' size='lg'>
          <Rocket className='mr-2 size-4' /> {t('publish')}
        </Button>
      </LocaleLink>
    </div>
  )
}
