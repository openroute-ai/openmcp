'use client'

import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@workspace/ui/components/chart'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { useIsMobile } from '@workspace/ui/hooks/use-mobile'
import { StatCard } from '@/components/dashboard/overview/stat-card'
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

type TrendDirection = 'up' | 'down' | 'stable'

/** 近 7 天对比再前 7 天，返回方向与幅度（0–100）。 */
function calculateTrend(
  daily: Array<{ date: string; calls: number; spend: number }>,
  field: 'calls' | 'spend'
): { direction: TrendDirection; percentage: number } {
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

/**
 * 创作者 KPI 行：调用、收益、访问、下载、已发布。
 *
 * 与消费者视图共用 `StatCard` 外壳，保证两种角色的卡片密度一致；
 * 第 5 张卡刻意用「已发布资产数」而不是收藏数 —— 收藏数在资产表现
 * 卡的 chips 里同样能看到，而"我一共发了几个"才是创作者的定位指标。
 */
export function ProviderKpiCards({
  data,
  isLoading = false,
}: {
  data?: ProviderStatsData | null
  isLoading?: boolean
}) {
  const t = useTranslations('Dashboard.providerStats')

  const trendCalls = calculateTrend(data?.daily ?? [], 'calls')
  const trendIncome = calculateTrend(data?.daily ?? [], 'spend')

  const trendText = (trend: { direction: TrendDirection; percentage: number }) => {
    switch (trend.direction) {
      case 'up':
        return t('trendingUp', { percentage: formatPercentage(trend.percentage) })
      case 'down':
        return t('trendingDown', { percentage: formatPercentage(trend.percentage) })
      default:
        return t('trendingStable')
    }
  }

  const assets = [
    { key: 'skills', label: t('assets.skills'), count: data?.publishedAssets?.skills ?? 0 },
    { key: 'mcpServers', label: t('assets.mcpServers'), count: data?.publishedAssets?.mcpServers ?? 0 },
    { key: 'a2aAgents', label: t('assets.a2aAgents'), count: data?.publishedAssets?.a2aAgents ?? 0 },
    { key: 'personas', label: t('assets.personas'), count: data?.publishedAssets?.personas ?? 0 },
  ]

  return (
    <div className='grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-5 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card'>
      <StatCard
        label={t('calls')}
        isLoading={isLoading}
        value={formatNumber(data?.calls ?? 0, { useLocale: true })}
        action={<TrendBadge trend={trendCalls} />}
        footer={
          <span className={`line-clamp-1 ${getTrendColor(trendCalls.direction)}`}>
            {trendText(trendCalls)}
          </span>
        }
      />
      <StatCard
        label={t('income')}
        isLoading={isLoading}
        value={formatCurrency(data?.income ?? 0, 'CNY')}
        action={<TrendBadge trend={trendIncome} />}
        footer={
          <span className={`line-clamp-1 ${getTrendColor(trendIncome.direction)}`}>
            {trendText(trendIncome)}
          </span>
        }
      />
      <StatCard
        label={t('access')}
        isLoading={isLoading}
        value={formatNumber(data?.access ?? 0, { useLocale: true })}
        footer={<span className='text-muted-foreground line-clamp-1'>{t('accessHint')}</span>}
      />
      <StatCard
        label={t('downloads')}
        isLoading={isLoading}
        value={formatNumber(data?.downloads ?? 0, { useLocale: true })}
        footer={<span className='text-muted-foreground line-clamp-1'>{t('downloadsHint')}</span>}
      />
      <StatCard
        label={t('assetTotal')}
        isLoading={isLoading}
        value={formatNumber(data?.publishedAssets?.total ?? 0, { useLocale: true })}
        footer={
          <span className='text-muted-foreground line-clamp-1'>
            {assets.map((asset) => `${asset.label} ${asset.count}`).join(' · ')}
          </span>
        }
      />
    </div>
  )
}

/**
 * 调用与收入趋势卡（7 天 / 30 天切换）。
 *
 * 图表数据只来自 `providerDailyUsage` 账本：这个面板是创作者判断
 * 「最近跑得好不好」的依据，宁可显示空态也不放合成数据。
 */
export function ProviderUsageTrendCard({
  data,
  isLoading = false,
  className,
}: {
  data?: ProviderStatsData | null
  isLoading?: boolean
  className?: string
}) {
  const t = useTranslations('Dashboard.providerStats')
  const isMobile = useIsMobile()
  const [selectedRange, setSelectedRange] = React.useState<'7d' | '30d'>('30d')
  // 移动端不渲染切换按钮，直接派生为 7d —— 避免在 effect 里 setState。
  const timeRange = isMobile ? '7d' : selectedRange

  const chartData = React.useMemo(() => {
    const daily = (data?.daily ?? [])
      .map((item) => ({
        date: formatDateForChart(item.date),
        calls: Number(item.calls ?? 0),
        spend: Number(item.spend ?? 0),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - (timeRange === '7d' ? 7 : 30))
    cutoffDate.setHours(0, 0, 0, 0)

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

  if (isLoading) {
    return (
      <Card className={`@container/card ${className ?? ''}`}>
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

  return (
    <Card className={`@container/card ${className ?? ''}`}>
      <CardHeader>
        <CardTitle>{t('usageTrend')}</CardTitle>
        <CardDescription>{t('usageTrendDescription')}</CardDescription>
        <ToggleGroup
          type='single'
          value={timeRange}
          onValueChange={(value) => {
            if (value === '7d' || value === '30d') setSelectedRange(value)
          }}
          variant='outline'
          className='*:data-[slot=toggle-group-item]:!px-4 ml-auto hidden @[767px]/card:flex'
        >
          <ToggleGroupItem value='30d'>{t('last30Days')}</ToggleGroupItem>
          <ToggleGroupItem value='7d'>{t('last7Days')}</ToggleGroupItem>
        </ToggleGroup>
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
                tickFormatter={(value) => formatDateForChart(String(value))}
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
  )
}
