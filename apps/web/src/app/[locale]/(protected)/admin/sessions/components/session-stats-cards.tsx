'use client'

import { MonitorIcon, TimerIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { trpc } from '@/lib/trpc/client'

const CARDS = [
  { key: 'total', label: '总会话数', icon: MonitorIcon },
  { key: 'active', label: '活跃会话', icon: MonitorIcon },
  { key: 'expired', label: '已过期', icon: TimerIcon },
  { key: 'today', label: '今日新增', icon: MonitorIcon },
] as const

export function SessionStatsCards() {
  const { data, isLoading, error } = trpc.admin.sessions.getSessionsStats.useQuery()

  if (isLoading) {
    return (
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        {CARDS.map((card) => (
          <Card key={card.key}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <Skeleton className='h-4 w-16' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-8 w-14' />
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
          <CardTitle className='text-red-800 dark:text-red-200'>加载会话统计失败</CardTitle>
          <CardDescription className='text-red-600 dark:text-red-400'>{error.message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const stats = data?.success ? data.data : null

  return (
    <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
      {CARDS.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.key}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='font-medium text-sm'>{card.label}</CardTitle>
              <Icon className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='font-bold text-2xl tabular-nums'>
                {(stats?.[card.key] ?? 0).toLocaleString('zh-CN')}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
