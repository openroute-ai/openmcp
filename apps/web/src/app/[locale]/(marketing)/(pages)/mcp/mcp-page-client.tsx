'use client'

import { Button } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ChevronLeft, ChevronRight, Search, Zap } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { McpServerCard, type McpServerCardData } from '@/components/mcp-servers/mcp-server-card'
import { McpServersHero } from '@/components/mcp-servers/mcp-servers-hero'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'
import { Routes } from '@/lib/routes'

const PAGE_SIZE = 18

type Filters = {
  search?: string
  transport?: 'http' | 'sse' | 'stdio'
  scope?: 'public' | 'private' | 'team'
  sort?: 'date-desc' | 'downloads-desc' | 'views-desc'
}

function toParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.transport) params.set('transport', filters.transport)
  if (filters.scope) params.set('scope', filters.scope)
  if (filters.sort && filters.sort !== 'date-desc') params.set('sort', filters.sort)
  if (page > 1) params.set('page', String(page))
  return params
}

export interface McpMarketPageClientProps {
  initialSearch: string
  initialTransport: string
  initialScope: string
  initialSort: string
  initialPage: string
}

type McpServerRow = {
  id: string
  name: string
  description: string | null
  descriptionEn: string | null
  transport: string
  hosting: string
  authType: string | null
  priceType: string
  billingModel: string | null
  unitPrice: string | null
  currency: string
  downloads: number
  certified: boolean
  category: { name: string; nameEn: string } | null
}

export function McpMarketPageClient(props: McpMarketPageClientProps) {
  const { initialSearch, initialTransport, initialScope, initialSort, initialPage } = props
  const t = useTranslations('McpPage')
  const router = useRouter()
  const pathname = usePathname()
  // `registry-labels` only branches on zh/en, so normalize the BCP-47 tag.
  const lang = useLocale() === 'zh' ? 'zh' : 'en'

  // The server page parses the query string, so these props already match the
  // URL. Re-keying on the query (see McpServersInner below) keeps back/forward
  // navigation in sync without a setState-in-effect mirror.
  const filters: Filters = useMemo(
    () => ({
      search: initialSearch || undefined,
      transport: (['http', 'sse', 'stdio'] as const).find((v) => v === initialTransport),
      scope: (['public', 'private', 'team'] as const).find((v) => v === initialScope),
      sort: (['date-desc', 'downloads-desc', 'views-desc'] as const).find((v) => v === initialSort),
    }),
    [initialSearch, initialTransport, initialScope, initialSort]
  )
  const page = Math.max(1, parseInt(initialPage, 10) || 1)

  const updateURL = useCallback(
    (nextFilters: Filters, nextPage: number) => {
      const query = toParams(nextFilters, nextPage).toString()
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [router, pathname]
  )

  const { data, isLoading } = trpc.mcpServers.getMcpServers.useQuery(
    {
      page,
      limit: PAGE_SIZE,
      search: filters.search,
      transport: filters.transport,
      scope: filters.scope,
      sort: filters.sort,
    },
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

  const rows: McpServerRow[] = data?.success ? (data.data ?? []) : []
  const pagination = data?.success ? data.pagination : undefined
  const failed = data ? !data.success : false

  const cards: McpServerCardData[] = rows.map((row) => {
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
      transport: row.transport,
      hosting: row.hosting,
      authType: row.authType,
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
      <McpServersHero
        onSearch={handleSearch}
        totalServers={pagination?.total ?? 0}
        initialSearch={filters.search ?? ''}
      />
      <section className='pb-16'>
        <div className='mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
          {isLoading ? (
            <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-48 rounded-lg' />
              ))}
            </div>
          ) : failed ? (
            <div className='py-12 text-center text-muted-foreground'>{t('list.loadError')}</div>
          ) : cards.length === 0 ? (
            <McpEmptyState searching={!!filters.search} />
          ) : (
            <>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
                {cards.map((server) => (
                  <McpServerCard key={server.id} server={server} />
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

function McpEmptyState({ searching }: { searching: boolean }) {
  const t = useTranslations('McpPage.list')

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
      <LocaleLink href={`${Routes.MCP}/submit`}>
        <Button type='button' size='lg'>
          <Zap className='mr-2 size-4' /> {t('publish')}
        </Button>
      </LocaleLink>
    </div>
  )
}
