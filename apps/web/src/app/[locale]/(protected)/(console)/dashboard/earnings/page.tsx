'use client'

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
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import PaginationBox from '@/components/web/pagination-box'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { formatCurrency } from '@/lib/utils'

const STATEMENTS_PAGE_SIZE = 12

/**
 * 我的收益：只保留与月度账单直接相关的东西。
 *
 * 技能销售明细、提现申请、调用统计和趋势图都在这张页面上被拿掉了——它们要么
 * 已经并进月度账单（销售/网关调用按月结算），要么是与收益无关的经营指标。
 * 逐笔核对走账单详情页 `/dashboard/earnings/[id]`。
 */
export default function EarningsPage() {
  const t = useTranslations('Dashboard.earnings')
  const [page, setPage] = useState(1)

  const { data: providerStatusData, isLoading: isLoadingStatus } =
    trpc.dashboard.getUserProviderStatus.useQuery()
  const {
    data: statementsRes,
    isLoading,
  } = trpc.providers.listMyStatements.useQuery(
    { page, pageSize: STATEMENTS_PAGE_SIZE },
    { retry: false }
  )

  const isProvider = providerStatusData?.data?.isProvider
  const statements = statementsRes?.success ? statementsRes.data : null

  const statementStatusLabel = (status: string) => {
    const key = `statements.status${status.charAt(0).toUpperCase()}${status.slice(1)}` as
      | 'statements.statusPending'
      | 'statements.statusConfirmed'
      | 'statements.statusPaid'
      | 'statements.statusRolled'
    return t.has(key) ? t(key) : status
  }

  const summary = statements?.summary
  const kpis = [
    {
      label: t('kpi.netTotal'),
      hint: t('kpi.netTotalHint'),
      value: summary?.netTotal ?? 0,
    },
    {
      label: t('kpi.paidTotal'),
      hint: t('kpi.paidTotalHint'),
      value: summary?.paid ?? 0,
    },
    {
      label: t('kpi.pendingTotal'),
      hint: t('kpi.pendingTotalHint'),
      // 待到账 = 还没变成"已打款"的两种状态之和：待确认 + 待打款。
      value: (summary?.pending ?? 0) + (summary?.confirmed ?? 0),
    },
  ]

  return (
    <>
      <DashboardHeader
        breadcrumbs={[{ label: t('title'), isCurrentPage: true }]}
        actions={
          <LocaleLink href={Routes.ProviderPayout}>
            <Button type='button' variant='outline' size='sm'>
              {t('managePayoutAccount')}
            </Button>
          </LocaleLink>
        }
      />

      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl space-y-7'>
          <div>
            <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
            <p className='mt-2 text-muted-foreground'>{t('description')}</p>
          </div>

          {isLoadingStatus ? (
            <Skeleton className='h-32 w-full' />
          ) : !isProvider ? (
            <Card>
              <CardContent className='flex flex-col items-center gap-3 py-12 text-center'>
                <p className='text-muted-foreground'>{t('notProvider')}</p>
                <LocaleLink href={Routes.ProviderOnboarding}>
                  <Button type='button' variant='outline' size='sm'>
                    {t('goOnboarding')}
                  </Button>
                </LocaleLink>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className='grid gap-3 sm:grid-cols-3'>
                {kpis.map((kpi) => (
                  <Card key={kpi.label}>
                    <CardHeader className='pb-2'>
                      <CardTitle className='font-medium text-muted-foreground text-sm'>{kpi.label}</CardTitle>
                      <CardDescription className='text-xs'>{kpi.hint}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {isLoading || !summary ? (
                        <Skeleton className='h-8 w-24' />
                      ) : (
                        <div className='font-semibold text-2xl tabular-nums'>
                          {formatCurrency(kpi.value, 'CNY')}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>{t('statements.title')}</CardTitle>
                  <CardDescription>{t('statements.description')}</CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {isLoading ? (
                    <Skeleton className='h-40 w-full' />
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('statements.tablePeriod')}</TableHead>
                            <TableHead>{t('statements.tableNet')}</TableHead>
                            <TableHead>{t('statements.tableCarryover')}</TableHead>
                            <TableHead>{t('statements.tableSettlement')}</TableHead>
                            <TableHead>{t('statements.tableStatus')}</TableHead>
                            <TableHead>{t('statements.tableAction')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(statements?.rows ?? []).length === 0 ? (
                            <TableRow>
                              <TableCell className='py-8 text-center text-muted-foreground' colSpan={6}>
                                {t('statements.tableEmpty')}
                              </TableCell>
                            </TableRow>
                          ) : (
                            (statements?.rows ?? []).map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className='font-medium'>{row.period}</TableCell>
                                <TableCell className='tabular-nums'>
                                  {formatCurrency(row.netAmount, row.currency)}
                                </TableCell>
                                <TableCell className='tabular-nums'>
                                  {/* carryover 恒为 0 或负数，直接显示会读成"减了 -30"，
                                      这里取绝对值表达"抵扣了多少"。 */}
                                  {row.carryoverAmount < 0
                                    ? formatCurrency(-row.carryoverAmount, row.currency)
                                    : '—'}
                                </TableCell>
                                <TableCell className='tabular-nums'>
                                  {formatCurrency(row.settlement, row.currency)}
                                </TableCell>
                                <TableCell>
                                  <div>{statementStatusLabel(row.status)}</div>
                                  {row.status === 'rolled' ? (
                                    <div className='text-muted-foreground text-xs'>
                                      {t('statements.rollHint')}
                                    </div>
                                  ) : null}
                                  {row.status === 'paid' && row.payoutReference ? (
                                    <div className='font-mono text-muted-foreground text-xs'>
                                      {row.payoutReference}
                                    </div>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  <LocaleLink href={`${Routes.DashboardEarnings}/${row.id}`}>
                                    <Button type='button' variant='ghost' size='sm'>
                                      {t('statements.view')}
                                    </Button>
                                  </LocaleLink>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                      <PaginationBox
                        page={page}
                        count={statements?.total ?? 0}
                        pageSize={STATEMENTS_PAGE_SIZE}
                        onPageChange={setPage}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}
