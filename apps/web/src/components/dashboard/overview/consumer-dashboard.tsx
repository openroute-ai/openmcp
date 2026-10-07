'use client'

import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import { KeyIcon, SearchIcon, WalletIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@workspace/ui/components/chart'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { useIsMobile } from '@workspace/ui/hooks/use-mobile'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { authClient } from '@/lib/auth-client'
import { formatCurrency, formatDateForChart, formatNumber, formatPercentage } from '@/lib/utils'
import { RecentActivityTabs } from '@/components/dashboard/overview/recent-activity-tabs'
import { StatCard } from '@/components/dashboard/overview/stat-card'
import type { RecentDownload } from '@/components/dashboard/recent-downloads-list'
import type { RecentFavorite } from '@/components/dashboard/recent-favorites-list'

export interface ConsumerDashboardData {
  balance?: { amount: number; amountTotal: number; amountSpend: number; amountGifted: number }
  usageSummary?: {
    monthSpend: number
    prevMonthSpend: number
    monthPurchases: number
    monthDownloads: number
    monthCalls: number
  }
  usageDaily?: Array<{ date: string; spend: number; downloads: number }>
  installCount?: number
  workflowStats?: {
    totalFavorites: number
    totalDownloads: number
    recentDownloads?: RecentDownload[]
    recentFavorites?: RecentFavorite[]
  }
}

interface ConsumerDashboardProps {
  data?: ConsumerDashboardData
  isLoading?: boolean
  error?: Error | null
}

/**
 * 普通用户概览：钱包、消费、收藏/安装、用量趋势与快捷入口。
 *
 * 指标刻意全部来自「这个账号花了多少、装了什么」，而不是网关的
 * tokens/requests —— 后者在 `totals` 数据缺失时会长期渲染成一排 0，
 * 让首屏看起来像坏掉了。
 */
export function ConsumerDashboard({ data, isLoading = false, error = null }: ConsumerDashboardProps) {
  const t = useTranslations('Dashboard')
  const { data: session } = authClient.useSession()
  const name = session?.user?.name || ''

  const balance = data?.balance
  const usage = data?.usageSummary
  const workflowStats = data?.workflowStats

  const monthSpend = usage?.monthSpend ?? 0
  const prevMonthSpend = usage?.prevMonthSpend ?? 0
  const spendPct =
    prevMonthSpend > 0 ? ((monthSpend - prevMonthSpend) / prevMonthSpend) * 100 : null

  const isFresh =
    monthSpend === 0 &&
    (workflowStats?.totalFavorites ?? 0) === 0 &&
    (workflowStats?.totalDownloads ?? 0) === 0 &&
    (data?.installCount ?? 0) === 0

  const spendTrendUp = spendPct !== null && spendPct > 0

  return (
    <div className='flex flex-col gap-4'>
      {/* 页头动作：始终可见，让新账号第一眼知道能做什么 */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h1 className='font-bold text-xl tracking-tight'>
            {name ? t('overview.welcome', { name }) : t('dashboard.title')}
          </h1>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <LocaleLink href={Routes.ApiKeys}>
            <Button type='button' size='sm'>
              {t('consumer.quickActions.createApiKey')}
            </Button>
          </LocaleLink>
          <LocaleLink href={Routes.SettingsRecharge}>
            <Button type='button' variant='outline' size='sm'>
              {t('consumer.stats.recharge')}
            </Button>
          </LocaleLink>
          <LocaleLink href={Routes.Skills}>
            <Button type='button' variant='ghost' size='sm'>
              {t('consumer.quickActions.browse')}
            </Button>
          </LocaleLink>
        </div>
      </div>

      {/* KPI 行 */}
      <div className='grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card'>
        <StatCard
          label={t('consumer.stats.balance')}
          isLoading={isLoading}
          value={formatCurrency(balance?.amount ?? 0, 'CNY')}
          footer={
            <LocaleLink href={Routes.SettingsRecharge} className='text-primary font-medium hover:underline'>
              {t('consumer.stats.recharge')} →
            </LocaleLink>
          }
        />
        <StatCard
          label={t('consumer.stats.monthSpend')}
          isLoading={isLoading}
          value={formatCurrency(monthSpend, 'CNY')}
          action={
            spendPct !== null ? (
              <Badge variant='outline'>
                {spendTrendUp ? <IconTrendingUp className='size-4' /> : <IconTrendingDown className='size-4' />}
                <span className={spendTrendUp ? 'text-red-600' : 'text-green-600'}>
                  {formatPercentage(Math.abs(spendPct))}
                </span>
              </Badge>
            ) : undefined
          }
          footer={
            <span className='text-muted-foreground line-clamp-1'>
              {spendPct === null
                ? monthSpend > 0 || prevMonthSpend > 0
                  ? t('consumer.stats.noLastMonth')
                  : t('consumer.stats.monthSpendHint')
                : spendPct > 0
                  ? t('consumer.stats.vsLastMonthUp', {
                      percentage: formatPercentage(Math.abs(spendPct)),
                    })
                  : spendPct < 0
                    ? t('consumer.stats.vsLastMonthDown', {
                        percentage: formatPercentage(Math.abs(spendPct)),
                      })
                    : t('consumer.stats.vsLastMonthFlat')}
            </span>
          }
        />
        <StatCard
          label={t('consumer.stats.favorites')}
          isLoading={isLoading}
          value={formatNumber(workflowStats?.totalFavorites ?? 0, { useLocale: true })}
          footer={
            <LocaleLink href={Routes.MyFavorites} className='text-primary font-medium hover:underline'>
              {t('consumer.stats.view')} →
            </LocaleLink>
          }
        />
        <StatCard
          label={t('consumer.stats.installs')}
          isLoading={isLoading}
          value={formatNumber(data?.installCount ?? 0, { useLocale: true })}
          footer={
            <LocaleLink href={Routes.MyInstalls} className='text-primary font-medium hover:underline'>
              {t('consumer.stats.view')} →
            </LocaleLink>
          }
        />
      </div>

      {/* 趋势 + 快捷操作 */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <ConsumerUsageChart
          daily={data?.usageDaily ?? []}
          isLoading={isLoading}
          className='lg:col-span-2'
        />
        <QuickActionsCard isFresh={isFresh} isLoading={isLoading} />
      </div>

      {/* 消费动态 */}
      <RecentActivityTabs
        downloads={workflowStats?.recentDownloads}
        favorites={workflowStats?.recentFavorites}
        isLoading={isLoading}
        error={error}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ConsumerUsageChart({
  daily,
  isLoading = false,
  className,
}: {
  daily: Array<{ date: string; spend: number; downloads: number }>
  isLoading?: boolean
  className?: string
}) {
  const t = useTranslations('Dashboard.consumer.trend')
  const isMobile = useIsMobile()
  const [selectedRange, setSelectedRange] = React.useState<'7d' | '30d'>('30d')
  // 移动端不渲染切换按钮，直接派生为 7d —— 避免在 effect 里 setState。
  const timeRange = isMobile ? '7d' : selectedRange

  const chartData = React.useMemo(() => {
    const now = new Date()
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - (timeRange === '7d' ? 7 : 30))
    cutoff.setHours(0, 0, 0, 0)

    return [...daily]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .filter((row) => new Date(row.date) >= cutoff)
      .map((row) => ({ date: row.date, spend: row.spend, downloads: row.downloads }))
  }, [daily, timeRange])

  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      spend: { label: t('spend'), color: 'var(--primary)' },
      downloads: { label: t('downloads'), color: 'var(--chart-2)' },
    }),
    [t]
  )

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='h-4 w-48' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[250px] w-full' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={`@container/card ${className ?? ''}`}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <ToggleGroup
          type='single'
          value={timeRange}
          onValueChange={(value) => {
            if (value === '7d' || value === '30d') setSelectedRange(value)
          }}
          variant='outline'
          className='*:data-[slot=toggle-group-item]:!px-4 ml-auto hidden @[767px]/card:flex'
        >
          <ToggleGroupItem value='7d'>{t('last7Days')}</ToggleGroupItem>
          <ToggleGroupItem value='30d'>{t('last30Days')}</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
        {chartData.length === 0 ? (
          <div className='flex h-[250px] w-full items-center justify-center px-6 text-center text-muted-foreground text-sm'>
            {t('empty')}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className='aspect-auto h-[250px] w-full'>
            <AreaChart data={chartData} accessibilityLayer>
              <defs>
                <linearGradient id='fillSpend' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='5%' stopColor='var(--color-spend)' stopOpacity={0.35} />
                  <stop offset='95%' stopColor='var(--color-spend)' stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id='fillDownloads' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='5%' stopColor='var(--color-downloads)' stopOpacity={0.35} />
                  <stop offset='95%' stopColor='var(--color-downloads)' stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey='date'
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                tickFormatter={(value) => formatDateForChart(String(value))}
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Area
                dataKey='spend'
                type='monotone'
                stroke='var(--color-spend)'
                fill='url(#fillSpend)'
                stackId='1'
              />
              <Area
                dataKey='downloads'
                type='monotone'
                stroke='var(--color-downloads)'
                fill='url(#fillDownloads)'
                stackId='2'
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

interface QuickAction {
  icon: React.ReactNode
  title: string
  description: string
  href: string
}

function QuickActionsCard({ isFresh, isLoading = false }: { isFresh: boolean; isLoading?: boolean }) {
  const t = useTranslations('Dashboard.consumer')

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-3'>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className='h-14 w-full' />
          ))}
        </CardContent>
      </Card>
    )
  }

  const actions: QuickAction[] = [
    {
      icon: <KeyIcon className='size-4' />,
      title: t('quickActions.createApiKey'),
      description: t('quickActions.createApiKeyHint'),
      href: Routes.ApiKeys,
    },
    {
      icon: <WalletIcon className='size-4' />,
      title: t('quickActions.recharge'),
      description: t('quickActions.rechargeHint'),
      href: Routes.SettingsRecharge,
    },
    {
      icon: <SearchIcon className='size-4' />,
      title: t('quickActions.browse'),
      description: t('quickActions.browseHint'),
      href: Routes.Skills,
    },
    {
      icon: <SparklesIcon className='size-4' />,
      title: t('quickActions.becomeCreator'),
      description: t('quickActions.becomeCreatorHint'),
      href: Routes.ProviderOnboarding,
    },
  ]

  return (
    <Card className='@container/card'>
      <CardHeader>
        <CardTitle>{isFresh ? t('onboarding.title') : t('quickActions.title')}</CardTitle>
        {isFresh && <CardDescription>{t('onboarding.description')}</CardDescription>}
      </CardHeader>
      <CardContent className='flex flex-col gap-2 px-4 pb-4 sm:px-6'>
        {isFresh && (
          <ol className='mb-1 flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm'>
            {['step1', 'step2', 'step3'].map((step, index) => (
              <li key={step} className='flex items-center gap-2'>
                <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs'>
                  {index + 1}
                </span>
                <span className='text-muted-foreground'>{t(`onboarding.${step}`)}</span>
              </li>
            ))}
          </ol>
        )}
        {actions.map((action) => (
          <LocaleLink
            key={action.href + action.title}
            href={action.href}
            className='flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:bg-accent'
          >
            <span className='flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary'>
              {action.icon}
            </span>
            <span className='flex min-w-0 flex-col'>
              <span className='truncate font-medium text-sm'>{action.title}</span>
              <span className='truncate text-muted-foreground text-xs'>{action.description}</span>
            </span>
            <span className='ml-auto text-muted-foreground'>→</span>
          </LocaleLink>
        ))}
      </CardContent>
    </Card>
  )
}
