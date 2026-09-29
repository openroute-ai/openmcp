'use client'

import { useTranslations } from 'next-intl'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { ProviderStatsSection } from '@/components/dashboard/provider-stats-section'
import { RecentDownloadsList } from '@/components/dashboard/recent-downloads-list'
import { RecentFavoritesList } from '@/components/dashboard/recent-favorites-list'
import { SectionCards } from '@/components/dashboard/section-cards'
import { trpc } from '@/lib/trpc/client'

/**
 * Dashboard overview page
 *
 * All data is fetched here in a single trpc call; the child components only
 * take care of rendering.
 */
export default function DashboardPage() {
  const t = useTranslations()

  const { data, isLoading, error } = trpc.dashboard.getUserDashboardDataAction.useQuery({
    days: 60,
  })

  const breadcrumbs = [
    {
      label: t('Dashboard.dashboard.title'),
      isCurrentPage: true,
    },
  ]

  if (error) {
    return (
      <>
        <DashboardHeader breadcrumbs={breadcrumbs} />
        <div className='flex flex-1 flex-col'>
          <div className='@container/main flex flex-1 flex-col gap-2'>
            <div className='flex flex-col gap-4 py-4 md:gap-6 md:py-6'>
              <div className='px-4 lg:px-6'>
                <div className='rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20'>
                  <p className='text-red-600 dark:text-red-400'>{error?.message || t('Dashboard.loadError')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='flex flex-1 flex-col'>
        <div className='@container/main flex flex-1 flex-col gap-2'>
          <div className='flex flex-col gap-4 py-4 md:gap-6 md:py-6'>
            {data?.data?.isProvider ? (
              <div className='grid grid-cols-1 gap-4'>
                <ProviderStatsSection
                  data={data.data.providerStats}
                  isLoading={isLoading}
                  error={error || undefined}
                />
              </div>
            ) : (
              <SectionCards
                data={{
                  totals: data?.data?.totals ?? undefined,
                  chartData: data?.data?.chartData ?? [],
                  workflowStats: data?.data?.workflowStats,
                }}
                isLoading={isLoading}
                error={error || undefined}
              />
            )}
            <div className='grid grid-cols-1 gap-4 px-4 lg:px-6'>
              <RecentDownloadsList
                data={data?.data?.workflowStats?.recentDownloads}
                isLoading={isLoading}
                error={error || undefined}
              />
              <RecentFavoritesList
                data={data?.data?.workflowStats?.recentFavorites}
                isLoading={isLoading}
                error={error || undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
