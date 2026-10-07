'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { ReceiptIcon, TrendingDown, WalletCards } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import EmptyStates from '@/components/web/empty-states'
import LoadingSpinner from '@/components/web/loading-spinner'
import PaginationBox from '@/components/web/pagination-box'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { formatCurrency, formatDate } from '@/lib/utils'

export default function BillsPage() {
  const t = useTranslations('Dashboard.bills')

  const [currentPage, setCurrentPage] = useState(1)
  const [shouldLoadData, setShouldLoadData] = useState(false)
  const pageSize = 10

  const { data: balanceData, isLoading: isLoadingBalance } = trpc.recharge.getUserBalance.useQuery({})
  const { data: historyData, isLoading: isLoadingHistory } = trpc.recharge.getRechargeHistory.useQuery(
    { page: currentPage, pageSize },
    { enabled: shouldLoadData }
  )

  useEffect(() => {
    setShouldLoadData(true)
  }, [])

  const balance = balanceData?.data
  const records = historyData?.data?.records ?? []

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  const statCards = [
    {
      icon: WalletCards,
      label: t('balance.available'),
      value: isLoadingBalance ? null : formatCurrency(balance?.accountBalance ?? 0, 'CNY'),
    },
    {
      icon: ReceiptIcon,
      label: t('balance.total'),
      value: isLoadingBalance ? null : formatCurrency(balance?.amount ?? 0, 'CNY'),
    },
    {
      icon: WalletCards,
      label: t('balance.gifted'),
      value: isLoadingBalance ? null : formatCurrency(balance?.amountGifted ?? 0, 'CNY'),
    },
    {
      icon: TrendingDown,
      label: t('balance.spend'),
      value: isLoadingBalance ? null : formatCurrency(balance?.amountSpend ?? 0, 'CNY'),
    },
  ]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl space-y-7'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
              <p className='mt-2 text-muted-foreground'>{t('description')}</p>
              <p className='mt-1 text-muted-foreground text-sm'>{t('deprecatedNote')}</p>
            </div>
            <Button className='cursor-pointer' asChild>
              <LocaleLink href={Routes.SettingsRecharge}>{t('goRecharge')}</LocaleLink>
            </Button>
          </div>

          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {statCards.map((card) => (
              <Card key={card.label}>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <CardTitle className='font-medium text-muted-foreground text-sm'>{card.label}</CardTitle>
                  <card.icon className='size-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  {card.value === null ? (
                    <Skeleton className='h-8 w-24' />
                  ) : (
                    <div className='font-semibold text-2xl tabular-nums'>{card.value}</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>{t('history.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <LoadingSpinner />
              ) : !shouldLoadData || records.length === 0 ? (
                <EmptyStates title={t('history.empty')} description=' ' />
              ) : (
                <>
                  <div className='overflow-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('history.date')}</TableHead>
                          <TableHead>{t('history.amount')}</TableHead>
                          <TableHead>{t('history.type')}</TableHead>
                          <TableHead>{t('history.channel')}</TableHead>
                          <TableHead>{t('history.status')}</TableHead>
                          <TableHead>{t('history.remark')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((row, index) => (
                          <TableRow key={`${row.id}-${index}`}>
                            <TableCell className='text-muted-foreground text-sm'>
                              {formatDate(new Date(row.date))}
                            </TableCell>
                            <TableCell className='font-medium tabular-nums'>{row.amount}</TableCell>
                            <TableCell>{row.type === 'recharge' ? t('type.recharge') : t('type.recharge')}</TableCell>
                            <TableCell>{row.channel}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.status === 'completed'
                                    ? 'outline'
                                    : row.status === 'processing'
                                      ? 'default'
                                      : 'destructive'
                                }
                              >
                                {row.status === 'completed'
                                  ? t('status.completed')
                                  : row.status === 'processing'
                                    ? t('status.processing')
                                    : t('status.failed')}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-muted-foreground text-sm'>{row.remark}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className='mt-4'>
                    <PaginationBox
                      page={currentPage}
                      count={historyData?.data?.total ?? 0}
                      pageSize={historyData?.data?.pageSize ?? pageSize}
                      onPageChange={setCurrentPage}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
