'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { trpc } from '@/lib/trpc/client'

/**
 * Header counters for the users page.
 *
 * Every card is defined here rather than by the caller: the set is fixed, and
 * a shared definition keeps the loading and error states from drifting between
 * cards (the source app rendered five skeletons and five separate error
 * cards for the same five metrics).
 *
 * Counts are rendered with plain locale grouping, not `@/lib/utils`
 * `formatNumber`, which abbreviates to "1.5K". An operator reconciling a count
 * against a database query needs the exact number.
 */
const CARDS = [
  { key: 'total', label: '总用户数', description: '注册用户总数' },
  { key: 'active', label: '活跃用户', description: '有已支付充值订单的用户' },
  { key: 'todayRegistered', label: '今日注册', description: '今天新注册的用户数' },
  { key: 'todayRecharge', label: '今日充值', description: '今天有充值订单的用户数' },
  { key: 'banned', label: '已封禁', description: '当前处于封禁状态的用户' },
] as const

const formatCount = (value: number | undefined) => (value ?? 0).toLocaleString('zh-CN')

export function UserStatsCards() {
  const { data, isLoading, error } = trpc.admin.users.getUsersStats.useQuery()

  if (isLoading) {
    return (
      <div className='grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-5'>
        {CARDS.map((card) => (
          <Card key={card.key} className='@container/card'>
            <CardHeader>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-8 w-24' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-4 w-32' />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className='border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'>
        <CardHeader>
          <CardDescription className='text-red-600 dark:text-red-400'>加载用户统计失败</CardDescription>
          <CardTitle className='text-red-800 dark:text-red-200'>{error.message}</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  const stats = data?.success ? data.data : null

  return (
    <div className='grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-5'>
      {CARDS.map((card) => (
        <Card key={card.key} className='@container/card'>
          <CardHeader className='flex flex-col'>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className='font-semibold text-2xl tabular-nums @[250px]/card:text-3xl'>
              {formatCount(stats?.[card.key])}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground text-sm'>{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
