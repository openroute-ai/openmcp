'use client'

import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { useLocaleRouter } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { formatCurrency } from '@/lib/utils'

type UsageType = 'all' | 'mcp_call' | 'a2a_call' | 'skill_download' | 'skill_purchase' | 'recharge'

const USAGE_TYPES: Exclude<UsageType, 'all'>[] = [
  'mcp_call',
  'a2a_call',
  'skill_download',
  'skill_purchase',
  'recharge',
]

function monthBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const toInput = (d: Date) => d.toISOString().slice(0, 10)
  return { start: toInput(start), end: toInput(end) }
}

function monthRange(month: string) {
  const [year, m] = month.split('-')
  const lastDay = new Date(Number(year), Number(m), 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` }
}

/** Shared loading / error / empty wrapper so both tables behave the same. */
function SectionState({
  isLoading,
  isError,
  isEmpty,
  errorText,
  emptyText,
  retryText,
  onRetry,
  children,
}: {
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  errorText: string
  emptyText: string
  retryText: string
  onRetry: () => void
  children: ReactNode
}) {
  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    )
  }

  if (isError) {
    return (
      <div className='text-sm'>
        <p className='text-destructive'>{errorText}</p>
        <Button type='button' variant='link' className='mt-2 h-auto p-0' onClick={onRetry}>
          {retryText}
        </Button>
      </div>
    )
  }

  if (isEmpty) return <p className='text-muted-foreground text-sm'>{emptyText}</p>

  return <>{children}</>
}

function UsagePageInner() {
  const t = useTranslations('Dashboard.usage')
  const tm = useTranslations('Dashboard.monthlyBilling')
  const router = useLocaleRouter()
  const searchParams = useSearchParams()
  const bounds = useMemo(() => monthBounds(), [])

  const [startDate, setStartDate] = useState(searchParams.get('startDate') || bounds.start)
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || bounds.end)
  const [type, setType] = useState<UsageType>('all')
  const detailRef = useRef<HTMLDivElement>(null)

  // Keep the filter inputs in sync when the month is changed from the table.
  useEffect(() => {
    const nextStart = searchParams.get('startDate')
    const nextEnd = searchParams.get('endDate')
    if (nextStart) setStartDate(nextStart)
    if (nextEnd) setEndDate(nextEnd)
  }, [searchParams])

  const { data, isLoading, isError, refetch } = trpc.dashboard.getUsageEvents.useQuery({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    type,
    limit: 100,
  })

  const {
    data: monthlyData,
    isLoading: monthlyLoading,
    isError: monthlyError,
    refetch: refetchMonthly,
  } = trpc.dashboard.getMonthlyBilling.useQuery({ months: 12 })

  const events = data?.data?.events ?? []
  const summary = data?.data?.summary ?? { monthSpend: 0, callCount: 0, downloadCount: 0 }
  const monthlyRows = monthlyData?.data ?? []
  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  const selectMonth = (month: string) => {
    const range = monthRange(month)
    setStartDate(range.start)
    setEndDate(range.end)
    router.replace(`${Routes.DashboardUsage}?startDate=${range.start}&endDate=${range.end}`, { scroll: false })
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl space-y-7'>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('description')}</p>
          </div>

          <div className='grid gap-4 sm:grid-cols-3'>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>{t('summary.monthSpend')}</CardDescription>
                <CardTitle className='text-2xl'>{formatCurrency(summary.monthSpend, 'CNY')}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>{t('summary.callCount')}</CardDescription>
                <CardTitle className='text-2xl'>{summary.callCount}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>{t('summary.downloadCount')}</CardDescription>
                <CardTitle className='text-2xl'>{summary.downloadCount}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{tm('title')}</CardTitle>
              <CardDescription>{tm('description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionState
                isLoading={monthlyLoading}
                isError={monthlyError || monthlyData?.success === false}
                isEmpty={monthlyRows.length === 0}
                errorText={tm('loadFailed')}
                emptyText={tm('table.empty')}
                retryText={tm('retry')}
                onRetry={() => void refetchMonthly()}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tm('table.month')}</TableHead>
                      <TableHead>{tm('table.total')}</TableHead>
                      <TableHead>{tm('table.calls')}</TableHead>
                      <TableHead>{tm('table.downloads')}</TableHead>
                      <TableHead>{tm('table.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyRows.map((row) => (
                      <TableRow key={row.month}>
                        <TableCell>{row.month}</TableCell>
                        <TableCell>{formatCurrency(row.spend, 'CNY')}</TableCell>
                        <TableCell>{row.calls}</TableCell>
                        <TableCell>{row.downloads}</TableCell>
                        <TableCell>
                          <Button type='button' variant='outline' size='sm' onClick={() => selectMonth(row.month)}>
                            {tm('table.viewDetail')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </SectionState>
            </CardContent>
          </Card>

          <div ref={detailRef} className='scroll-mt-6'>
            <Card>
              <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex flex-wrap items-end gap-3'>
                  <div className='space-y-1'>
                    <p className='text-muted-foreground text-xs'>{t('filters.dateRange')}</p>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='date'
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className='w-40'
                      />
                      <span className='text-muted-foreground'>—</span>
                      <Input
                        type='date'
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className='w-40'
                      />
                    </div>
                  </div>
                  <div className='space-y-1'>
                    <p className='text-muted-foreground text-xs'>{t('filters.type')}</p>
                    <Select value={type} onValueChange={(v) => setType(v as UsageType)}>
                      <SelectTrigger className='w-48'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all'>{t('filters.allTypes')}</SelectItem>
                        {USAGE_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`types.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <SectionState
                  isLoading={isLoading}
                  isError={isError || data?.success === false}
                  isEmpty={events.length === 0}
                  errorText={t('loadFailed')}
                  emptyText={t('table.empty')}
                  retryText={t('retry')}
                  onRetry={() => void refetch()}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('table.time')}</TableHead>
                        <TableHead>{t('table.resource')}</TableHead>
                        <TableHead>{t('table.type')}</TableHead>
                        <TableHead>{t('table.quantity')}</TableHead>
                        <TableHead>{t('table.amount')}</TableHead>
                        <TableHead>{t('table.status')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className='text-sm whitespace-nowrap'>{event.time}</TableCell>
                          <TableCell className='max-w-[220px] truncate'>{event.resource}</TableCell>
                          <TableCell>{t(`types.${event.type}`)}</TableCell>
                          <TableCell>{event.quantity}</TableCell>
                          <TableCell>{formatCurrency(event.amount, 'CNY')}</TableCell>
                          <TableCell>{event.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SectionState>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}

export default function UsagePage() {
  return (
    <Suspense>
      <UsagePageInner />
    </Suspense>
  )
}
