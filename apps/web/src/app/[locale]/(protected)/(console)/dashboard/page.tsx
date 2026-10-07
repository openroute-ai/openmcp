'use client'

import { useTranslations } from 'next-intl'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { ConsumerDashboard } from '@/components/dashboard/overview/consumer-dashboard'
import { CreatorDashboard } from '@/components/dashboard/overview/creator-dashboard'
import { trpc } from '@/lib/trpc/client'

/**
 * Dashboard overview page.
 *
 * All data is fetched here in a single trpc call; the child components only
 * take care of rendering. The role split is driven by `isProvider` (a real
 * `provider_profiles.authorId`, not the platform `role`), so a creator sees
 * the经营 view while everyone else sees the consumer view.
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

  const dashboardData = data?.data

  if (error) {
    return (
      <>
        <DashboardHeader breadcrumbs={breadcrumbs} />
        <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
          <div className='mx-auto flex w-full max-w-7xl flex-1 flex-col'>
            <div className='@container/main flex flex-1 flex-col gap-2'>
              <div className='flex flex-col gap-4 md:gap-6'>
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

      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto flex w-full max-w-7xl flex-1 flex-col'>
          <div className='@container/main flex flex-1 flex-col gap-2'>
            <div className='flex flex-col gap-4 md:gap-6'>
              {dashboardData?.isProvider ? (
                <CreatorDashboard
                  data={dashboardData}
                  isLoading={isLoading}
                  error={error || undefined}
                />
              ) : (
                <ConsumerDashboard
                  data={dashboardData}
                  isLoading={isLoading}
                  error={error || undefined}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
