'use client'

import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import { useTranslations } from 'next-intl'
import React from 'react'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { formatCurrency, formatNumber, formatPercentage, parseScientificNotation } from '@/lib/utils'

interface ChartDataItem {
  date: string
  promptTokens: number
  completionTokens: number
  dailyTokens: number
  successfulRequests: number
  failedRequests: number
  apiRequests: number
  spend: number
}

interface Totals {
  spend: number
  totalTokens: number
  completionTokens: number
  promptTokens: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
}

interface SectionCardsProps {
  data?: {
    totals?: Totals
    chartData?: ChartDataItem[]
    workflowStats?: {
      totalFavorites: number
      totalDownloads: number
    }
  }
  isLoading?: boolean
  error?: Error | null
}

type Trend = { direction: 'up' | 'down' | 'stable'; percentage: number }

export function SectionCards({ data, isLoading = false, error = null }: SectionCardsProps) {
  const t = useTranslations('Dashboard.stats')
  const tDashboard = useTranslations('Dashboard')

  const hasError = !!error

  // `totals` is only populated when gateway spend data exists. When it is null
  // the spend/token/request cards have nothing real to show, so they are left
  // out rather than rendered as a permanent row of zeros.
  const hasTotals = Boolean(data?.totals && data?.chartData)

  const stats = React.useMemo(() => {
    if (!data?.totals || !data?.chartData) {
      const ws = data?.workflowStats
      return {
        spend: '0',
        currency: 'CNY',
        totalTokens: 0,
        totalRequests: 0,
        totalFavorites: ws?.totalFavorites ?? 0,
        totalDownloads: ws?.totalDownloads ?? 0,
        trends: {
          spend: { direction: 'stable', percentage: 0 },
          tokens: { direction: 'stable', percentage: 0 },
          requests: { direction: 'stable', percentage: 0 },
          favorites: { direction: 'stable', percentage: 0 },
          downloads: { direction: 'stable', percentage: 0 },
        } satisfies Record<string, Trend>,
      }
    }

    const totals = data.totals
    const chartData = data.chartData
    const workflowStats = data.workflowStats

    const spendValue = parseScientificNotation(totals.spend)

    // Trend = last 7 days against the 7 days before that.
    const calculateTrend = (field: 'spend' | 'totalTokens' | 'totalRequests'): Trend => {
      if (chartData.length < 14) {
        return { direction: 'stable', percentage: 0 }
      }

      const recent = chartData.slice(-7)
      const previous = chartData.slice(-14, -7)

      let recentTotal = 0
      let previousTotal = 0

      if (field === 'spend') {
        recentTotal = recent.reduce((sum, item) => sum + parseScientificNotation(item.spend || 0), 0)
        previousTotal = previous.reduce((sum, item) => sum + parseScientificNotation(item.spend || 0), 0)
      } else if (field === 'totalTokens') {
        recentTotal = recent.reduce((sum, item) => sum + (item.dailyTokens || 0), 0)
        previousTotal = previous.reduce((sum, item) => sum + (item.dailyTokens || 0), 0)
      } else if (field === 'totalRequests') {
        recentTotal = recent.reduce((sum, item) => sum + (item.apiRequests || 0), 0)
        previousTotal = previous.reduce((sum, item) => sum + (item.apiRequests || 0), 0)
      }

      if (previousTotal === 0) {
        return recentTotal > 0 ? { direction: 'up', percentage: 100 } : { direction: 'stable', percentage: 0 }
      }

      const percentage = ((recentTotal - previousTotal) / previousTotal) * 100
      return {
        direction: percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'stable',
        percentage: Math.abs(percentage),
      }
    }

    return {
      spend: spendValue.toFixed(8),
      currency: 'CNY',
      totalTokens: totals.totalTokens,
      totalRequests: totals.totalRequests,
      totalFavorites: workflowStats?.totalFavorites || 0,
      totalDownloads: workflowStats?.totalDownloads || 0,
      trends: {
        spend: calculateTrend('spend'),
        tokens: calculateTrend('totalTokens'),
        requests: calculateTrend('totalRequests'),
        favorites: { direction: 'stable', percentage: 0 } as Trend,
        downloads: { direction: 'stable', percentage: 0 } as Trend,
      } satisfies Record<string, Trend>,
    }
  }, [data])

  // Get trend icon and color
  const getTrendIcon = (direction: string | undefined) => {
    switch (direction) {
      case 'up':
        return <IconTrendingUp className='size-4' />
      case 'down':
        return <IconTrendingDown className='size-4' />
      default:
        return null
    }
  }

  const getTrendColor = (direction: string | undefined) => {
    switch (direction) {
      case 'up':
        return 'text-green-600'
      case 'down':
        return 'text-red-600'
      default:
        return 'text-gray-600'
    }
  }

  const getTrendText = (direction: string | undefined, percentage: number) => {
    switch (direction) {
      case 'up':
        return t('trendingUp', { percentage: formatPercentage(percentage) })
      case 'down':
        return t('trendingDown', { percentage: formatPercentage(percentage) })
      default:
        return t('trendingStable')
    }
  }

  // Loading skeleton component
  const CardSkeleton = () => (
    <Card className='@container/card'>
      <CardHeader>
        <Skeleton className='h-4 w-20' />
        <Skeleton className='h-8 w-24' />
        <CardAction>
          <Skeleton className='h-6 w-16' />
        </CardAction>
      </CardHeader>
      <CardFooter className='flex-col items-start gap-1.5'>
        <Skeleton className='h-4 w-32' />
        <Skeleton className='h-4 w-24' />
      </CardFooter>
    </Card>
  )

  // Error state component
  const ErrorCard = ({ title, description }: { title: string; description: string }) => (
    <Card className='@container/card border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'>
      <CardHeader>
        <CardDescription className='text-red-600 dark:text-red-400'>{title}</CardDescription>
        <CardTitle className='text-red-800 dark:text-red-200'>--</CardTitle>
      </CardHeader>
      <CardFooter className='flex-col items-start gap-1.5 text-sm'>
        <div className='text-red-600 dark:text-red-400'>{description}</div>
      </CardFooter>
    </Card>
  )

  const gridClass =
    'grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-5 dark:*:data-[slot=card]:bg-card'

  // Show loading skeletons while loading
  if (isLoading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: hasTotals ? 5 : 2 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    )
  }

  // Show error state if there's an error
  if (hasError) {
    return (
      <div className={gridClass}>
        {Array.from({ length: hasTotals ? 5 : 2 }).map((_, index) => (
          <ErrorCard key={index} title={tDashboard('loadError')} description={tDashboard('loadError')} />
        ))}
      </div>
    )
  }

  return (
    <div className={gridClass}>
      {/* Total Spend Card */}
      {hasTotals && (
        <Card className='@container/card'>
          <CardHeader className='flex flex-col'>
            <div className='flex w-full flex-row items-center justify-between gap-2'>
              <CardDescription>{t('totalSpend')}</CardDescription>
              <CardAction>
                <Badge variant='outline'>
                  {getTrendIcon(stats.trends.spend.direction)}
                  {formatPercentage(stats.trends.spend.percentage)}
                </Badge>
              </CardAction>
            </div>
            <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>
              {formatCurrency(stats.spend, stats.currency)}
            </CardTitle>
          </CardHeader>
          <CardFooter className='flex-col items-start gap-1.5 text-sm'>
            <div className={`line-clamp-1 flex gap-2 font-medium ${getTrendColor(stats.trends.spend.direction)}`}>
              {getTrendText(stats.trends.spend.direction, stats.trends.spend.percentage)}
              {getTrendIcon(stats.trends.spend.direction)}
            </div>
            <div className='text-muted-foreground'>{t('spendLast6Months')}</div>
          </CardFooter>
        </Card>
      )}

      {/* Total Tokens Card */}
      {hasTotals && (
        <Card className='@container/card'>
          <CardHeader className='flex flex-col'>
            <div className='flex w-full flex-row items-center justify-between gap-2'>
              <CardDescription>{t('totalTokens')}</CardDescription>
              <CardAction>
                <Badge variant='outline'>
                  {getTrendIcon(stats.trends.tokens.direction)}
                  {formatPercentage(stats.trends.tokens.percentage)}
                </Badge>
              </CardAction>
            </div>
            <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>
              {formatNumber(stats.totalTokens, { useLocale: true })}
            </CardTitle>
          </CardHeader>
          <CardFooter className='flex-col items-start gap-1.5 text-sm'>
            <div className={`line-clamp-1 flex gap-2 font-medium ${getTrendColor(stats.trends.tokens.direction)}`}>
              {getTrendText(stats.trends.tokens.direction, stats.trends.tokens.percentage)}
              {getTrendIcon(stats.trends.tokens.direction)}
            </div>
            <div className='text-muted-foreground'>{t('acquisitionNeedsAttention')}</div>
          </CardFooter>
        </Card>
      )}

      {/* Total Requests Card */}
      {hasTotals && (
        <Card className='@container/card'>
          <CardHeader className='flex flex-col'>
            <div className='flex w-full flex-row items-center justify-between gap-2'>
              <CardDescription>{t('totalRequests')}</CardDescription>
              <CardAction>
                <Badge variant='outline'>
                  {getTrendIcon(stats.trends.requests.direction)}
                  {formatPercentage(stats.trends.requests.percentage)}
                </Badge>
              </CardAction>
            </div>
            <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>
              {formatNumber(stats.totalRequests, { useLocale: true })}
            </CardTitle>
          </CardHeader>
          <CardFooter className='flex-col items-start gap-1.5 text-sm'>
            <div className={`line-clamp-1 flex gap-2 font-medium ${getTrendColor(stats.trends.requests.direction)}`}>
              {getTrendText(stats.trends.requests.direction, stats.trends.requests.percentage)}
              {getTrendIcon(stats.trends.requests.direction)}
            </div>
            <div className='text-muted-foreground'>{t('engagementExceedTargets')}</div>
          </CardFooter>
        </Card>
      )}

      {/* Total Favorites Card */}
      <Card className='@container/card'>
        <CardHeader className='flex flex-col'>
          <div className='flex w-full flex-row items-center justify-between gap-2'>
            <CardDescription>{t('totalFavorites')}</CardDescription>
            <CardAction>
              <Badge variant='outline'>
                {getTrendIcon(stats.trends.favorites.direction)}
                {formatPercentage(stats.trends.favorites.percentage)}
              </Badge>
            </CardAction>
          </div>
          <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>
            {formatNumber(stats.totalFavorites, { useLocale: true })}
          </CardTitle>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className={`line-clamp-1 flex gap-2 font-medium ${getTrendColor(stats.trends.favorites.direction)}`}>
            {getTrendText(stats.trends.favorites.direction, stats.trends.favorites.percentage)}
            {getTrendIcon(stats.trends.favorites.direction)}
          </div>
          <div className='text-muted-foreground'>{t('workflowFavorites')}</div>
        </CardFooter>
      </Card>

      {/* Total Downloads Card */}
      <Card className='@container/card'>
        <CardHeader className='flex flex-col'>
          <div className='flex w-full flex-row items-center justify-between gap-2'>
            <CardDescription>{t('totalDownloads')}</CardDescription>
            <CardAction>
              <Badge variant='outline'>
                {getTrendIcon(stats.trends.downloads.direction)}
                {formatPercentage(stats.trends.downloads.percentage)}
              </Badge>
            </CardAction>
          </div>
          <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>
            {formatNumber(stats.totalDownloads, { useLocale: true })}
          </CardTitle>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className={`line-clamp-1 flex gap-2 font-medium ${getTrendColor(stats.trends.downloads.direction)}`}>
            {getTrendText(stats.trends.downloads.direction, stats.trends.downloads.percentage)}
            {getTrendIcon(stats.trends.downloads.direction)}
          </div>
          <div className='text-muted-foreground'>{t('workflowDownloads')}</div>
        </CardFooter>
      </Card>
    </div>
  )
}
