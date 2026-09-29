'use client'

import { IconChartBar, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@workspace/ui/components/chart'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { useIsMobile } from '@workspace/ui/hooks/use-mobile'
import { formatCurrency, formatDateForChart, formatNumber, formatPercentage } from '@/lib/utils'

export interface ProviderStatsData {
  publishedAssets: {
    skills: number
    mcpServers: number
    a2aAgents: number
    personas: number
    total: number
  }
  access: number
  downloads: number
  favorites: number
  calls: number
  income: number
  callsTotal: number
  incomeTotal: number
  hasUsageData: boolean
  daily: Array<{ date: string; calls: number; spend: number }>
}

interface ProviderStatsSectionProps {
  data?: ProviderStatsData | null
  isLoading?: boolean
  error?: Error | null
}

type TrendDirection = 'up' | 'down' | 'stable'

function getTrendIcon(direction: TrendDirection) {
  switch (direction) {
    case 'up':
      return <IconTrendingUp className='size-4' />
    case 'down':
      return <IconTrendingDown className='size-4' />
    default:
      return null
  }
}

function getTrendColor(direction: TrendDirection) {
  switch (direction) {
    case 'up':
      return 'text-green-600'
    case 'down':
      return 'text-red-600'
    default:
      return 'text-gray-600'
  }
}

function TrendBadge({ trend }: { trend: { direction: TrendDirection; percentage: number } }) {
  return (
    <Badge variant='outline'>
      {getTrendIcon(trend.direction)}
      <span className={getTrendColor(trend.direction)}>{formatPercentage(trend.percentage)}</span>
    </Badge>
  )
}

function CardSkeleton() {
  return (
    <Card className='@container/card'>
      <CardHeader>
        <Skeleton className='h-4 w-20' />
        <Skeleton className='h-8 w-24' />
        <CardAction>
          <Skeleton className='h-6 w-16' />
        </CardAction>
      </CardHeader>
      <CardContent className='px-6 pb-4'>
        <Skeleton className='h-4 w-32' />
      </CardContent>
    </Card>
  )
}

function ChartSkeleton() {
  return (
    <Card className='@container/card col-span-2'>
      <CardHeader>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-4 w-48' />
      </CardHeader>
      <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
        <Skeleton className='h-[250px] w-full' />
      </CardContent>
    </Card>
  )
}

export function ProviderStatsSection({ data, isLoading = false, error = null }: ProviderStatsSectionProps) {
  const t = useTranslations('Dashboard.providerStats')
  const tDashboard = useTranslations('Dashboard')
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState<'7d' | '30d'>('30d')

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange('7d')
    }
  }, [isMobile])

  const handleTimeRangeChange = (value: string) => {
    if (value === '7d' || value === '30d') {
      setTimeRange(value)
    }
  }

  // Trend = last 7 days against the 7 days before that.
  const calculateTrend = (field: 'calls' | 'spend'): { direction: TrendDirection; percentage: number } => {
    const daily = data?.daily ?? []
    if (daily.length < 14) {
      return { direction: 'stable', percentage: 0 }
    }
    const recent = daily.slice(-7)
    const previous = daily.slice(-14, -7)
    const recentTotal = recent.reduce((sum, item) => sum + Number(item[field] ?? 0), 0)
    const previousTotal = previous.reduce((sum, item) => sum + Number(item[field] ?? 0), 0)

    if (previousTotal === 0) {
      return recentTotal > 0 ? { direction: 'up', percentage: 100 } : { direction: 'stable', percentage: 0 }
    }
    const percentage = ((recentTotal - previousTotal) / previousTotal) * 100
    return {
      direction: percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'stable',
      percentage: Math.abs(percentage),
    }
  }

  const trendCalls = calculateTrend('calls')
  const trendIncome = calculateTrend('spend')

  // Chart data, filtered to the selected time range.
  const chartData = React.useMemo(() => {
    const daily = (data?.daily ?? [])
      .map((item) => ({
        date: formatDateForChart(item.date),
        calls: Number(item.calls ?? 0),
        spend: Number(item.spend ?? 0),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    const now = new Date()
    const cutoffDate = new Date(now)
    cutoffDate.setDate(cutoffDate.getDate() - (timeRange === '7d' ? 7 : 30))

    return daily.filter((item) => {
      const itemDate = new Date(item.date)
      itemDate.setHours(0, 0, 0, 0)
      return itemDate >= cutoffDate
    })
  }, [data?.daily, timeRange])

  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      calls: { label: t('calls'), color: 'var(--primary)' },
      spend: { label: t('income'), color: 'var(--chart-2)' },
    }),
    [t]
  )

  const getTrendText = (direction: TrendDirection, percentage: number) => {
    switch (direction) {
      case 'up':
        return t('trendingUp', { percentage: formatPercentage(percentage) })
      case 'down':
        return t('trendingDown', { percentage: formatPercentage(percentage) })
      default:
        return t('trendingStable')
    }
  }

  const stats = [
    {
      key: 'calls',
      label: t('calls'),
      value: formatNumber(data?.calls ?? 0, { useLocale: true }),
      footer: getTrendText(trendCalls.direction, trendCalls.percentage),
      footerColor: getTrendColor(trendCalls.direction),
      action: <TrendBadge trend={trendCalls} />,
    },
    {
      key: 'income',
      label: t('income'),
      value: formatCurrency(data?.income ?? 0, 'CNY'),
      footer: getTrendText(trendIncome.direction, trendIncome.percentage),
      footerColor: getTrendColor(trendIncome.direction),
      action: <TrendBadge trend={trendIncome} />,
    },
    {
      key: 'access',
      label: t('access'),
      value: formatNumber(data?.access ?? 0, { useLocale: true }),
      footer: t('accessHint'),
      footerColor: 'text-gray-600',
      action: null,
    },
    {
      key: 'downloads',
      label: t('downloads'),
      value: formatNumber(data?.downloads ?? 0, { useLocale: true }),
      footer: t('downloadsHint'),
      footerColor: 'text-gray-600',
      action: null,
    },
    {
      key: 'favorites',
      label: t('favorites'),
      value: formatNumber(data?.favorites ?? 0, { useLocale: true }),
      footer: t('favoritesHint'),
      footerColor: 'text-gray-600',
      action: null,
    },
  ]

  const assets = [
    { key: 'skills', label: t('assets.skills'), count: data?.publishedAssets?.skills ?? 0 },
    { key: 'mcpServers', label: t('assets.mcpServers'), count: data?.publishedAssets?.mcpServers ?? 0 },
    { key: 'a2aAgents', label: t('assets.a2aAgents'), count: data?.publishedAssets?.a2aAgents ?? 0 },
    { key: 'personas', label: t('assets.personas'), count: data?.publishedAssets?.personas ?? 0 },
  ]

  if (isLoading) {
    return (
      <div className='flex flex-col gap-4 px-4 lg:px-6'>
        <div className='grid @5xl/main:grid-cols-5 @xl/main:grid-cols-2 grid-cols-1 gap-4'>
          {Array.from({ length: 5 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
          <ChartSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='flex flex-col gap-4 px-4 lg:px-6'>
        <Card className='border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'>
          <CardHeader>
            <CardDescription className='text-red-600 dark:text-red-400'>{tDashboard('loadError')}</CardDescription>
            <CardTitle className='text-red-800 dark:text-red-200'>--</CardTitle>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4 px-4 lg:px-6'>
      <div className='grid @5xl/main:grid-cols-5 @xl/main:grid-cols-2 grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card'>
        {stats.map((item) => (
          <Card key={item.key} className='@container/card'>
            <CardHeader className='flex flex-col'>
              <div className='flex w-full flex-row items-center justify-between gap-2'>
                <CardDescription>{item.label}</CardDescription>
                {item.action}
              </div>
              <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>{item.value}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col items-start gap-1.5 px-6 pb-4 text-sm'>
              <div className={`line-clamp-1 flex gap-2 font-medium ${item.footerColor}`}>{item.footer}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='@container/card lg:col-span-2'>
          <CardHeader>
            <CardTitle>{t('usageTrend')}</CardTitle>
            <CardDescription>{t('usageTrendDescription')}</CardDescription>
            <CardAction>
              <ToggleGroup
                type='single'
                value={timeRange}
                onValueChange={handleTimeRangeChange}
                variant='outline'
                className='*:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex hidden'
              >
                <ToggleGroupItem value='30d'>{t('last30Days')}</ToggleGroupItem>
                <ToggleGroupItem value='7d'>{t('last7Days')}</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          </CardHeader>
          <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
            {chartData.length === 0 ? (
              <div className='flex h-[250px] w-full items-center justify-center text-muted-foreground'>
                {t('noData')}
              </div>
            ) : (
              <ChartContainer config={chartConfig} className='aspect-auto h-[250px] w-full'>
                <BarChart data={chartData} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey='date'
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={(value) => formatDateForChart(value)}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null
                      const row = payload[0]?.payload as { date: string; calls: number; spend: number }
                      return (
                        <div className='rounded-lg border bg-background p-3 shadow-sm'>
                          <div className='mb-2 font-medium text-sm'>{row.date}</div>
                          <div className='flex flex-col gap-1.5'>
                            <div className='flex justify-between gap-4'>
                              <span className='text-muted-foreground text-sm'>{t('calls')}:</span>
                              <span className='font-medium text-sm'>
                                {formatNumber(row.calls ?? 0, { useLocale: true })}
                              </span>
                            </div>
                            <div className='flex justify-between gap-4'>
                              <span className='text-muted-foreground text-sm'>{t('income')}:</span>
                              <span className='font-medium text-sm'>
                                {formatCurrency(row.spend ?? 0, 'CNY', { maximumFractionDigits: 6 })}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey='calls' fill='var(--color-calls)' radius={[4, 4, 0, 0]} />
                  <Bar dataKey='spend' fill='var(--color-spend)' radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className='@container/card'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <IconChartBar className='size-4 text-muted-foreground' />
              {t('assetOverview')}
            </CardTitle>
            <CardDescription>{t('assetOverviewDescription')}</CardDescription>
          </CardHeader>
          <CardContent className='px-6 pb-4'>
            <div className='flex flex-col gap-4'>
              <div>
                <div className='text-3xl font-semibold tabular-nums'>
                  {formatNumber(data.publishedAssets?.total ?? 0, { useLocale: true })}
                </div>
                <div className='text-muted-foreground text-sm'>{t('assetTotal')}</div>
              </div>
              <div className='flex flex-col gap-2'>
                {assets.map((asset) => (
                  <div
                    key={asset.key}
                    className='flex flex-row items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm'
                  >
                    <span className='text-muted-foreground'>{asset.label}</span>
                    <span className='font-medium tabular-nums'>{formatNumber(asset.count, { useLocale: true })}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
