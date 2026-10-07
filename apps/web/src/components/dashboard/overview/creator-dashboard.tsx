'use client'

import { IconAlertTriangle } from '@tabler/icons-react'
import { Badge as UiBadge } from '@workspace/ui/components/badge'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { useTranslations } from 'next-intl'
import { ActivityFeed, type ActivityItem } from '@/components/dashboard/overview/activity-feed'
import {
  EarningsSummaryCard,
  type EarningsSnapshot,
} from '@/components/dashboard/overview/earnings-summary-card'
import { RecentActivityTabs } from '@/components/dashboard/overview/recent-activity-tabs'
import { TopAssetsCard, type TopAssetRow } from '@/components/dashboard/overview/top-assets-card'
import {
  ProviderKpiCards,
  ProviderUsageTrendCard,
  type ProviderStatsData,
} from '@/components/dashboard/provider-stats-section'
import type { RecentDownload } from '@/components/dashboard/recent-downloads-list'
import type { RecentFavorite } from '@/components/dashboard/recent-favorites-list'
import { authClient } from '@/lib/auth-client'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

export interface CreatorDashboardData {
  providerStats?: ProviderStatsData | null
  earnings?: EarningsSnapshot | null
  topAssets?: TopAssetRow[] | null
  activity?: ActivityItem[] | null
  workflowStats?: {
    recentDownloads?: RecentDownload[]
    recentFavorites?: RecentFavorite[]
  }
}

interface CreatorDashboardProps {
  data?: CreatorDashboardData
  isLoading?: boolean
  error?: Error | null
}

/**
 * 创作者概览：经营指标 + 结算状态 + 资产表现，末尾仍保留消费侧动态。
 *
 * 与消费者视图共用同一批卡片外壳与 Tab 区，差别集中在中间三块：
 * KPI 是经营口径、右侧是收益与资产、以及一条只在有待办时出现的
 * 账单确认提醒。
 */
export function CreatorDashboard({ data, isLoading = false, error = null }: CreatorDashboardProps) {
  const t = useTranslations('Dashboard')
  const { data: session } = authClient.useSession()
  const name = session?.user?.name || ''

  const earnings = data?.earnings ?? null
  const latest = earnings?.latest ?? null
  const showStatementAlert = Boolean(latest && latest.status === 'pending')

  return (
    <div className='flex flex-col gap-4'>
      {/* 页头：身份 + 经营动作 */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <h1 className='font-bold text-xl tracking-tight'>
            {name ? t('overview.creatorWorkspace', { name }) : t('dashboard.title')}
          </h1>
          <UiBadge variant='outline' className='text-green-700 dark:text-green-400'>
            {t('creator.verified')}
          </UiBadge>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <LocaleLink href={Routes.MyAssetsSkills}>
            <Button type='button' size='sm'>
              {t('creator.publish')}
            </Button>
          </LocaleLink>
          <LocaleLink href={Routes.ProviderPayout}>
            <Button type='button' variant='outline' size='sm'>
              {t('creator.payout')}
            </Button>
          </LocaleLink>
          <LocaleLink href={Routes.DashboardEarnings}>
            <Button type='button' variant='ghost' size='sm'>
              {t('creator.earningsCenter')}
            </Button>
          </LocaleLink>
        </div>
      </div>

      {/* 待办提醒：只有存在待确认账单时才出现 */}
      {showStatementAlert && latest && (
        <Alert>
          <IconAlertTriangle className='size-4' />
          <AlertTitle>{t('creator.earnings.latest')}</AlertTitle>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
            <span>
              {t('creator.alert.pendingStatement', {
                period: latest.period,
                deadline: new Date(latest.confirmDeadline).toISOString().slice(0, 10),
              })}
            </span>
            <LocaleLink
              href={`${Routes.DashboardEarnings}/${latest.id}`}
              className='font-medium text-primary hover:underline'
            >
              {t('creator.alert.confirm')} →
            </LocaleLink>
          </AlertDescription>
        </Alert>
      )}

      {/* KPI 行 */}
      <ProviderKpiCards data={data?.providerStats} isLoading={isLoading} />

      {/* 趋势 + 收益概览 */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <ProviderUsageTrendCard
          data={data?.providerStats}
          isLoading={isLoading}
          className='lg:col-span-2'
        />
        <EarningsSummaryCard data={earnings} isLoading={isLoading} />
      </div>

      {/* 资产表现 + 动态流 */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <TopAssetsCard
          data={data?.topAssets}
          breakdown={data?.providerStats?.publishedAssets}
          isLoading={isLoading}
          className='lg:col-span-2'
        />
        <ActivityFeed data={data?.activity} isLoading={isLoading} />
      </div>

      {/* 消费侧动态：创作者同样是消费者 */}
      <RecentActivityTabs
        downloads={data?.workflowStats?.recentDownloads}
        favorites={data?.workflowStats?.recentFavorites}
        isLoading={isLoading}
        error={error}
      />
    </div>
  )
}
