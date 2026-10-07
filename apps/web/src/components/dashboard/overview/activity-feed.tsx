'use client'

import { format } from 'date-fns'
import { CoinsIcon, DownloadIcon, FileTextIcon, HeartIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'

export interface ActivityItem {
  id: string
  kind: 'earning' | 'statement' | 'download' | 'favorite'
  time: string
  amount?: number
  period?: string
  status?: string
  title?: string | null
  titleEn?: string | null
}

interface ActivityFeedProps {
  data?: ActivityItem[] | null
  isLoading?: boolean
}

const KIND_ICON = {
  earning: <CoinsIcon className='size-4' />,
  statement: <FileTextIcon className='size-4' />,
  download: <DownloadIcon className='size-4' />,
  favorite: <HeartIcon className='size-4' />,
} as const

/**
 * 创作者动态流：收入入账、账单生成与自己的资产被下载/收藏混排。
 *
 * 只读真实事件，没有事件时显示空态，而不是用占位行撑高卡片。
 */
export function ActivityFeed({ data, isLoading = false }: ActivityFeedProps) {
  const t = useTranslations('Dashboard.creator.activity')
  const locale = useLocale()

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-3'>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className='h-10 w-full' />
          ))}
        </CardContent>
      </Card>
    )
  }

  const items = data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-1 px-4 pb-4 sm:px-6'>
        {items.length === 0 ? (
          <div className='py-8 text-center text-muted-foreground text-sm'>{t('empty')}</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className='flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/50'
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  item.kind === 'earning'
                    ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                    : 'bg-primary/10 text-primary'
                }`}
              >
                {KIND_ICON[item.kind]}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='line-clamp-1'>{describe(item, locale, t)}</span>
              </span>
              <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
                {format(new Date(item.time), 'MM-dd HH:mm')}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function describe(
  item: ActivityItem,
  locale: string,
  t: ReturnType<typeof useTranslations>
): string {
  switch (item.kind) {
    case 'earning':
      return `${t('earning')} +${(item.amount ?? 0).toFixed(2)}`
    case 'statement':
      return `${item.period ?? ''} ${t('statement')}`
    case 'download':
    case 'favorite': {
      const title =
        (locale === 'zh' ? item.title : item.titleEn) || item.title || '—'
      return `${title} ${t(item.kind)}`
    }
    default:
      return ''
  }
}
