'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { formatCurrency } from '@/lib/utils'

export interface EarningsSnapshot {
  netTotal: number
  pending: number
  confirmed: number
  paid: number
  rolled: number
  total: number
  latest: {
    id: string
    period: string
    status: 'pending' | 'confirmed' | 'paid' | 'rolled'
    settlement: number
    confirmDeadline: string
  } | null
}

interface EarningsSummaryCardProps {
  data?: EarningsSnapshot | null
  isLoading?: boolean
}

const STATUS_KEY = {
  pending: 'statementStatus.pending',
  confirmed: 'statementStatus.confirmed',
  paid: 'statementStatus.paid',
  rolled: 'statementStatus.rolled',
} as const

/**
 * 收益概览：结算口径的三个数字 + 最新一张账单。
 *
 * 与收益页的 KPI 同源（`listMyStatements` 的 summary），首页只做压缩：
 * 待结算 = 待确认 + 已确认待打款，也就是「还没到账的钱」。
 */
export function EarningsSummaryCard({ data, isLoading = false }: EarningsSummaryCardProps) {
  const t = useTranslations('Dashboard.creator')

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-3'>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className='h-6 w-full' />
          ))}
        </CardContent>
      </Card>
    )
  }

  const rows = [
    { label: t('earnings.netTotal'), value: data?.netTotal ?? 0, emphasis: false },
    { label: t('earnings.pending'), value: (data?.pending ?? 0) + (data?.confirmed ?? 0), emphasis: true },
    { label: t('earnings.paid'), value: data?.paid ?? 0, emphasis: false },
  ]

  const latest = data?.latest ?? null

  return (
    <Card className='@container/card'>
      <CardHeader>
        <CardTitle>{t('earnings.title')}</CardTitle>
        <CardAction>
          <LocaleLink href={Routes.DashboardEarnings} className='text-primary text-sm hover:underline'>
            {t('earnings.viewAll')} →
          </LocaleLink>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-col gap-3 px-6 pb-4'>
        {rows.map((row) => (
          <div key={row.label} className='flex items-center justify-between gap-3 text-sm'>
            <span className='text-muted-foreground'>{row.label}</span>
            <span
              className={`font-medium tabular-nums ${row.emphasis ? 'text-base' : ''}`}
            >
              {formatCurrency(row.value, 'CNY')}
            </span>
          </div>
        ))}

        <div className='border-t pt-3'>
          <div className='mb-1 text-muted-foreground text-xs'>{t('earnings.latest')}</div>
          {latest ? (
            <LocaleLink
              href={`${Routes.DashboardEarnings}/${latest.id}`}
              className='flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm hover:bg-accent'
            >
              <span className='font-medium tabular-nums'>{latest.period}</span>
              <Badge variant={latest.status === 'pending' ? 'default' : 'outline'}>
                {t(STATUS_KEY[latest.status])}
              </Badge>
            </LocaleLink>
          ) : (
            <div className='text-muted-foreground text-sm'>{t('earnings.empty')}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
