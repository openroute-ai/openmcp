'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@workspace/ui/components/table'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import PaginationBox from '@/components/web/pagination-box'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { formatCurrency, formatDateTime } from '@/lib/utils'

const DATE_LOCALES = { zh: 'zh-CN', en: 'en-US' } as const

const DETAIL_PAGE_SIZE = 20

/**
 * 单张月度账单的收益详情：账单本体、收益构成、逐笔明细与打款信息。
 *
 * 逐笔明细分页而不是一次拉全：一张账单会聚合整月的网关调用，大作者一个月
 * 上千行，全量渲染会把详情页拖死。
 */
export function StatementDetail({ id }: { id: string }) {
  const t = useTranslations('Dashboard.earnings')
  const locale = useLocale()
  const dateLocale = DATE_LOCALES[locale === 'zh' ? 'zh' : 'en']
  const utils = trpc.useUtils()
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState(false)

  const detail = trpc.providers.getMyStatementDetail.useQuery(
    { id, page, pageSize: DETAIL_PAGE_SIZE },
    { retry: false }
  )

  const confirmStatement = trpc.providers.confirmStatement.useMutation({
    onSuccess: (result) => {
      setConfirming(false)
      if (result.success) {
        toast.success(t('detail.toastConfirmed'))
        void utils.providers.getMyStatementDetail.invalidate()
        void utils.providers.listMyStatements.invalidate()
      } else {
        toast.error(result.error || t('detail.toastConfirmFailed'))
      }
    },
    onError: (mutationError) => {
      setConfirming(false)
      toast.error(mutationError.message || t('detail.toastConfirmFailed'))
    },
  })

  const data = detail.data?.success ? detail.data.data : null
  const statement = data?.statement
  const timeline = data?.timeline

  const statementStatusLabel = (status: string) => {
    const key = `statements.status${status.charAt(0).toUpperCase()}${status.slice(1)}` as
      | 'statements.statusPending'
      | 'statements.statusConfirmed'
      | 'statements.statusPaid'
      | 'statements.statusRolled'
    return t.has(key) ? t(key) : status
  }

  const statusVariant = (status: string) => {
    if (status === 'paid') return 'outline' as const
    if (status === 'rolled') return 'destructive' as const
    return 'secondary' as const
  }

  const kindLabel = (kind: string) =>
    kind === 'clawback' ? t('detail.kindClawback') : t('detail.kindSale')

  const sourceLabel = (sourceName: string | null) => sourceName ?? t('detail.gatewaySource')

  const channelLabel = (channel: string | null) => {
    if (channel === 'wechat') return t('detail.channelWechat')
    if (channel === 'alipay') return t('detail.channelAlipay')
    return t('detail.channelNone')
  }

  const dateLabel = (value: Date | string) =>
    new Date(value).toLocaleDateString(dateLocale, { year: 'numeric', month: 'numeric', day: 'numeric' })

  const stats = statement
    ? [
        { label: t('detail.gross'), value: formatCurrency(statement.grossAmount, statement.currency) },
        { label: t('detail.platformFee'), value: formatCurrency(statement.platformFee, statement.currency) },
        { label: t('detail.net'), value: formatCurrency(statement.netAmount, statement.currency) },
        {
          label: t('detail.carryover'),
          // carryover 恒为 0 或负数，取绝对值表达"抵扣了多少"。
          value:
            statement.carryoverAmount < 0
              ? formatCurrency(-statement.carryoverAmount, statement.currency)
              : '—',
        },
        { label: t('detail.settlement'), value: formatCurrency(statement.settlement, statement.currency) },
      ]
    : []

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: t('title'), href: Routes.DashboardEarnings },
          {
            label: statement ? t('detail.title', { period: statement.period }) : '…',
            isCurrentPage: true,
          },        ]}
      />

      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl space-y-7'>
          <LocaleLink
            href={Routes.DashboardEarnings}
            className='inline-block text-muted-foreground text-sm transition-colors hover:text-foreground'
          >
            ← {t('detail.back')}
          </LocaleLink>

          {detail.isLoading || (!data && detail.isFetching) ? (
            <Skeleton className='h-72 w-full' />
          ) : !data || !statement || !timeline ? (
            <Card>
              <CardContent className='flex flex-col items-center gap-3 py-12 text-center'>
                <p className='text-muted-foreground'>
                  {/* 网络失败与"这张账单不（再）存在"要分开说：前者可以重试，
                      后者重试只会拿到同一个答案。 */}
                  {detail.isError
                    ? t('detail.loadFailed')
                    : (detail.data && !detail.data.success ? detail.data.error : null) ??
                      t('detail.notFound')}
                </p>
                <Button type='button' variant='outline' size='sm' onClick={() => void detail.refetch()}>
                  {t('detail.retry')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-3'>
                <h1 className='font-bold text-2xl tracking-tight'>
                  {t('detail.title', { period: statement.period })}
                </h1>
                <Badge variant={statusVariant(statement.status)}>
                  {statementStatusLabel(statement.status)}
                </Badge>
              </div>

              <p className='text-muted-foreground text-sm'>
                {t('detail.timelineGenerate')}: {dateLabel(timeline.generateDate)} ·{' '}
                {t('detail.timelineConfirm')}: {dateLabel(timeline.confirmDeadline)} ·{' '}
                {t('detail.timelinePayout')}: {dateLabel(timeline.payoutDate)}
              </p>

              <div className='grid gap-3 sm:grid-cols-3 lg:grid-cols-5'>
                {stats.map((stat) => (
                  <div key={stat.label} className='rounded-lg border p-3'>
                    <div className='text-muted-foreground text-xs'>{stat.label}</div>
                    <div className='mt-1 font-semibold text-xl tabular-nums'>{stat.value}</div>
                  </div>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>{t('detail.breakdownTitle')}</CardTitle>
                  <CardDescription>{t('detail.breakdownDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('detail.breakdownSource')}</TableHead>
                        <TableHead>{t('detail.breakdownKind')}</TableHead>
                        <TableHead>{t('detail.breakdownCount')}</TableHead>
                        <TableHead>{t('detail.breakdownGross')}</TableHead>
                        <TableHead>{t('detail.breakdownFee')}</TableHead>
                        <TableHead>{t('detail.breakdownNet')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.breakdown.length === 0 ? (
                        <TableRow>
                          <TableCell className='py-8 text-center text-muted-foreground' colSpan={6}>
                            {t('detail.breakdownEmpty')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.breakdown.map((row, index) => (
                          // 分组键不落库，同名资产的 sale / clawback 会各占一行，
                          // 所以这里用序号而不是 sourceName 当 key。
                          <TableRow key={`${row.kind}-${row.sourceName ?? 'gateway'}-${index}`}>
                            <TableCell className='font-medium'>{sourceLabel(row.sourceName)}</TableCell>
                            <TableCell>{kindLabel(row.kind)}</TableCell>
                            <TableCell className='tabular-nums'>{row.count}</TableCell>
                            <TableCell className='tabular-nums'>
                              {formatCurrency(row.grossAmount, row.currency)}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {formatCurrency(row.platformFee, row.currency)}
                            </TableCell>
                            <TableCell className='font-medium tabular-nums'>
                              {formatCurrency(row.netAmount, row.currency)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>{t('detail.ledgerTitle')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('detail.ledgerTime')}</TableHead>
                        <TableHead>{t('detail.ledgerKind')}</TableHead>
                        <TableHead>{t('detail.ledgerSource')}</TableHead>
                        <TableHead>{t('detail.ledgerGross')}</TableHead>
                        <TableHead>{t('detail.ledgerFee')}</TableHead>
                        <TableHead>{t('detail.ledgerNet')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.earnings.rows.length === 0 ? (
                        <TableRow>
                          <TableCell className='py-8 text-center text-muted-foreground' colSpan={6}>
                            {t('detail.ledgerEmpty')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.earnings.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className='text-muted-foreground'>
                              {formatDateTime(row.createdAt)}
                            </TableCell>
                            <TableCell>{kindLabel(row.kind)}</TableCell>
                            <TableCell>{sourceLabel(row.sourceName)}</TableCell>
                            <TableCell className='tabular-nums'>
                              {formatCurrency(row.grossAmount, row.currency)}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {formatCurrency(row.platformFee, row.currency)}
                            </TableCell>
                            <TableCell className='font-medium tabular-nums'>
                              {formatCurrency(row.netAmount, row.currency)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <PaginationBox
                    page={page}
                    count={data.earnings.total}
                    pageSize={DETAIL_PAGE_SIZE}
                    onPageChange={setPage}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className='flex-row items-start justify-between gap-4 space-y-0'>
                  <div>
                    <CardTitle className='text-base'>{t('detail.payoutTitle')}</CardTitle>
                    <CardDescription>
                      {t('statements.description')}
                    </CardDescription>
                  </div>
                  {statement.status === 'pending' ? (
                    <Button
                      type='button'
                      size='sm'
                      disabled={confirming || !timeline.canConfirm}
                      onClick={() => {
                        setConfirming(true)
                        confirmStatement.mutate({ id: statement.id })
                      }}
                    >
                      {confirming ? t('detail.confirming') : t('detail.confirm')}
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <dl className='grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3'>
                    <div>
                      <dt className='text-muted-foreground text-xs'>{t('detail.payoutChannel')}</dt>
                      <dd className='font-medium'>{channelLabel(statement.payoutChannel)}</dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>{t('detail.payoutAccount')}</dt>
                      <dd className='font-mono font-medium break-all'>
                        {statement.payoutAccount ?? t('detail.channelNone')}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>{t('detail.payoutReference')}</dt>
                      <dd className='font-mono font-medium'>
                        {statement.payoutReference ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>{t('detail.confirmedAt')}</dt>
                      <dd className='font-medium'>
                        {statement.confirmedAt ? formatDateTime(statement.confirmedAt) : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>{t('detail.paidAt')}</dt>
                      <dd className='font-medium'>
                        {statement.paidAt ? formatDateTime(statement.paidAt) : '—'}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}
