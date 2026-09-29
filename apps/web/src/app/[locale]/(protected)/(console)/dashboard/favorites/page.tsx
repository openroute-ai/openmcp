'use client'

import { Card, CardContent } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { WorkflowsGrid } from '@/components/workflows/workflows-grid'
import { trpc } from '@/lib/trpc/client'

const LIMIT = 20

function parsePage(searchParams: URLSearchParams): number {
  const pageParam = searchParams.get('page')
  const parsed = pageParam ? parseInt(pageParam, 10) : 1
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed
}

function FavoritesPageInner() {
  const t = useTranslations('Dashboard')
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [page, setPage] = useState(() => parsePage(searchParams))

  const { data, isLoading, error } = trpc.dashboard.getUserFavorites.useQuery({
    page,
    limit: LIMIT,
  })

  // Keep state in sync so browser back/forward works.
  useEffect(() => {
    setPage(parsePage(searchParams))
  }, [searchParams])

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage)
      const params = new URLSearchParams(searchParams.toString())
      if (newPage === 1) {
        params.delete('page')
      } else {
        params.set('page', newPage.toString())
      }
      const newURL = params.toString() ? `${pathname}?${params.toString()}` : pathname
      router.push(newURL, { scroll: false })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [router, pathname, searchParams]
  )

  const breadcrumbs = [
    {
      label: t('dashboard.title'),
      href: '/dashboard',
    },
    {
      label: t('myFavorites.title'),
      isCurrentPage: true,
    },
  ]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='mx-auto flex w-full max-w-page flex-1 flex-col px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='@container/main flex flex-1 flex-col gap-2'>
          <div className='flex flex-col gap-4 py-4 md:gap-6 md:py-6'>
            <div className='px-4 lg:px-6'>
              <h1 className='mb-6 font-bold text-section'>{t('myFavorites.title')}</h1>

              {isLoading ? (
                <Card>
                  <CardContent className='p-6'>
                    <div className='space-y-4'>
                      <Skeleton className='h-8 w-64' />
                      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3'>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <Skeleton key={index} className='h-64 w-full' />
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : error || !data?.success ? (
                <Card>
                  <CardContent className='p-6'>
                    <div className='py-12 text-center'>
                      <p className='text-destructive text-lg'>{error?.message || data?.error || t('loadError')}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <WorkflowsGrid
                  workflows={data.data || []}
                  isLoading={isLoading}
                  error={error || undefined}
                  pagination={data.pagination}
                  onPageChange={handlePageChange}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function FavoritesPage() {
  return (
    <Suspense>
      <FavoritesPageInner />
    </Suspense>
  )
}
