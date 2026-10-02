'use client'

import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@workspace/ui/components/chart'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@workspace/ui/components/table'
import { useLocale, useTranslations } from 'next-intl'
import PaginationBox from '@/components/web/pagination-box'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, XAxis } from 'recharts'
import { toast } from 'sonner'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { formatCurrency } from '@/lib/utils'

interface DailyUsage {
  date: string
  calls: number
  spend: number
}

const DATE_LOCALES = { zh: 'zh-CN', en: 'en-US' } as const

const EARNINGS_PAGE_SIZE = 20

export default function EarningsPage() {
  const t = useTranslations('Dashboard.earnings')
  const locale = useLocale()
  const dateLocale = DATE_LOCALES[locale === 'zh' ? 'zh' : 'en']
  const utils = trpc.useUtils()
  const [earningsPage, setEarningsPage] = useState(1)
  const [payoutPage, setPayoutPage] = useState(1)
  const [statementPage, setStatementPage] = useState(1)

  const { data: providerStatusData, isLoading: isLoadingStatus } =
    trpc.dashboard.getUserProviderStatus.useQuery()
  const { data, isLoading, error, refetch } = trpc.dashboard.getUserDashboardDataAction.useQuery({
    days: 60,
  })

  const {
    data: earningsRes,
    isLoading: earningsLoading,
    refetch: refetchEarnings,
  } = trpc.providers.listMyEarnings.useQuery(
    { page: earningsPage, pageSize: EARNINGS_PAGE_SIZE },
    { retry: false }
  )
  const { data: payoutsRes, refetch: refetchPayouts } = trpc.providers.listMyPayoutRequests.useQuery(
    { page: payoutPage, pageSize: EARNINGS_PAGE_SIZE },
    { retry: false }
  )
  const { data: profileRes } = trpc.providers.getMyProfile.useQuery(undefined, { retry: false })
  const { data: statementsRes, refetch: refetchStatements } = trpc.providers.listMyStatements.useQuery(
    { page: statementPage, pageSize: EARNINGS_PAGE_SIZE },
    { retry: false }
  )
  const { data: timelineRes } = trpc.providers.getStatementTimeline.useQuery(undefined, { retry: false })

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmStatement = trpc.providers.confirmStatement.useMutation({
    onSuccess: (result) => {
      setConfirmingId(null)
      if (result.success) {
        toast.success(t('statements.toastConfirmed'))
        void refetchStatements()
        void utils.providers.listMyStatements.invalidate()
      } else {
        toast.error(result.error || t('statements.toastConfirmFailed'))
      }
    },
    onError: (mutationError) => {
      setConfirmingId(null)
      toast.error(mutationError.message || t('statements.toastConfirmFailed'))
    },
  })

  const [requesting, setRequesting] = useState(false)
  const requestPayout = trpc.providers.requestPayout.useMutation({
    onSuccess: (result) => {
      setRequesting(false)
      if (result.success) {
        toast.success(t('toast.requested'))
        void refetchEarnings()
        void refetchPayouts()
        void utils.providers.listMyPayoutRequests.invalidate()
      } else {
        toast.error(result.error || t('toast.requestFailed'))
      }
    },
    onError: (mutationError) => {
      setRequesting(false)
      toast.error(mutationError.message || t('toast.requestFailed'))
    },
  })

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  const providerStats = data?.data?.providerStats
  const isProvider = providerStatusData?.data?.isProvider

  const earnings = earningsRes?.success ? earningsRes.data : null
  const payouts = payoutsRes?.success ? payoutsRes.data : []
  const profile = profileRes?.success ? profileRes.data : null
  const payReady = profile?.payChannelStatus === 'ready'
  const statements = statementsRes?.success ? statementsRes.data : null
  const timeline = timelineRes?.success ? timelineRes.data : null

  const statementStatusLabel = (status: string) => {
    const key = `statements.status${status.charAt(0).toUpperCase()}${status.slice(1)}` as
      | 'statements.statusPending'
      | 'statements.statusConfirmed'
      | 'statements.statusPaid'
      | 'statements.statusRolled'
    return t.has(key) ? t(key) : status
  }

  const chartData: DailyUsage[] = (providerStats?.daily ?? []).map((row) => ({
    date: row.date,
    calls: Number(row.calls ?? 0),
    spend: Number(row.spend ?? 0),
  }))

  const chartConfig = {
    calls: {
      label: t('chart.calls'),
      color: 'var(--chart-1)',
    },
    spend: {
      label: t('chart.income'),
      color: 'var(--chart-2)',
    },
  } satisfies ChartConfig

  const formatShortDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' })

  const statCards = [
    {
      label: t('stats.calls30'),
      value: providerStats ? providerStats.calls.toLocaleString() : null,
    },
    {
      label: t('stats.income30'),
      value: providerStats ? formatCurrency(providerStats.income ?? 0, 'CNY') : null,
    },
    {
      label: t('stats.callsTotal'),
      value: providerStats ? providerStats.callsTotal.toLocaleString() : null,
    },
    {
      label: t('stats.incomeTotal'),
      value: providerStats ? formatCurrency(providerStats.incomeTotal ?? 0, 'CNY') : null,
    },
  ]

  const perCall =
    providerStats && providerStats.callsTotal > 0
      ? (providerStats.incomeTotal ?? 0) / providerStats.callsTotal
      : 0

  const statusLabel = (status: string) => {
    const key = status as 'payable' | 'paid' | 'pending' | 'approved' | 'rejected'
    if (t.has(`status.${key}`)) return t(`status.${key}`)
    return status
  }

  const channelLabel = (channel?: string | null) => {
    if (channel === 'wechat') return t('channel.wechat')
    if (channel === 'alipay') return t('channel.alipay')
    return t('channel.unknown')
  }

  const handleRequestPayout = () => {
    if (!payReady) {
      toast.error(t('toast.payAccountRequired'))
      return
    }
    setRequesting(true)
    requestPayout.mutate({})
  }

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='flex-1 px-gutter py-8 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto w-full max-w-page space-y-7'>
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
              <Card>
                <CardHeader className='flex-row items-center justify-between space-y-0'>
                  <div>
                    <CardTitle className='text-base'>{t('payoutAccount')}</CardTitle>
                    <CardDescription>{t('payoutAccountHint')}</CardDescription>
                  </div>
                  <LocaleLink href={Routes.ProviderPayout}>
                    <Button type='button' variant='outline' size='sm'>
                      {t('managePayoutAccount')}
                    </Button>
                  </LocaleLink>
                </CardHeader>
                <CardContent>
                  <p className='text-muted-foreground text-sm'>
                    {t('statusLabel', { status: payReady ? t('payReady') : t('payNotReady') })}
                  </p>
                </CardContent>
              </Card>

              <Tabs defaultValue='skills'>
                <TabsList>
                  <TabsTrigger
                    value='skills'
                    onClick={() =>
                      document.getElementById('earnings-skills')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    {t('tabs.skills')}
                  </TabsTrigger>
                  <TabsTrigger
                    value='gateway'
                    onClick={() =>
                      document.getElementById('earnings-gateway')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    {t('tabs.gateway')}
                  </TabsTrigger>
                  <TabsTrigger
                    value='payouts'
                    onClick={() =>
                      document.getElementById('earnings-payouts')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    {t('tabs.payouts')}
                  </TabsTrigger>
                  <TabsTrigger
                    value='statements'
                    onClick={() =>
                      document.getElementById('earnings-statements')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    {t('tabs.statements')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <Card>
                <CardHeader className='flex-row items-start justify-between gap-4 space-y-0'>
                  <div>
                    <CardTitle id='earnings-skills' className='text-base'>
                      {t('skillsShareTitle')}
                    </CardTitle>
                    <CardDescription>
                      {t('skillsShareDescription', {
                        share: ((earnings?.summary.revenueShare ?? 0.7) * 100).toFixed(0),
                        fee: (100 - (earnings?.summary.revenueShare ?? 0.7) * 100).toFixed(0),
                      })}
                    </CardDescription>
                  </div>
                  <Button
                    type='button'
                    size='sm'
                    disabled={requesting || !earnings?.summary.payable || earnings.summary.payable <= 0}
                    onClick={handleRequestPayout}
                  >
                    {requesting ? t('requesting') : t('requestPayout')}
                  </Button>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {earningsLoading ? (
                    <Skeleton className='h-20 w-full' />
                  ) : (
                    <>
                      <div className='grid gap-3 sm:grid-cols-3'>
                        {(['payable', 'paid', 'total'] as const).map((key) => (
                          <div key={key} className='rounded-lg border p-3'>
                            <div className='text-muted-foreground text-xs'>{t(`summary.${key}`)}</div>
                            <div className='mt-1 font-semibold text-xl tabular-nums'>
                              {formatCurrency(earnings?.summary[key] ?? 0, 'CNY')}
                            </div>
                          </div>
                        ))}
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('skillsTable.skill')}</TableHead>
                            <TableHead>{t('skillsTable.gross')}</TableHead>
                            <TableHead>{t('skillsTable.platformFee')}</TableHead>
                            <TableHead>{t('skillsTable.net')}</TableHead>
                            <TableHead>{t('skillsTable.status')}</TableHead>
                            <TableHead>{t('skillsTable.createdAt')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(earnings?.rows ?? []).length === 0 ? (
                            <TableRow>
                              <TableCell className='py-8 text-center text-muted-foreground' colSpan={6}>
                                {t('skillsTable.empty')}
                              </TableCell>
                            </TableRow>
                          ) : (
                            (earnings?.rows ?? []).map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>
                                  {/* 三种来源互斥：Skill 购买 / MCP / A2A。都没有时是
                                      解析不出资产名的网关调用，不是数据坏了。 */}
                                  {row.sourceName ?? row.skillId ?? row.assetId ?? t('earnings.gatewayCall')}
                                </TableCell>
                                <TableCell className='tabular-nums'>
                                  {formatCurrency(Number(row.grossAmount), 'CNY')}
                                </TableCell>
                                <TableCell className='tabular-nums'>
                                  {formatCurrency(Number(row.platformFee), 'CNY')}
                                </TableCell>
                                <TableCell className='tabular-nums'>
                                  {formatCurrency(Number(row.netAmount), 'CNY')}
                                </TableCell>
                                <TableCell>{statusLabel(row.status)}</TableCell>
                                <TableCell className='text-muted-foreground'>
                                  {row.createdAt
                                    ? new Date(row.createdAt).toLocaleString(dateLocale, { hour12: false })
                                    : t('payouts.empty')}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                          <PaginationBox
                            page={earningsPage}
                            count={earnings?.total ?? 0}
                            pageSize={EARNINGS_PAGE_SIZE}
                            onPageChange={setEarningsPage}
                          />

                      {(payouts?.length ?? 0) > 0 ? (
                        <div className='space-y-2'>
                          <h3 id='earnings-payouts' className='font-medium text-sm'>
                            {t('payouts.title')}
                          </h3>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t('payouts.amount')}</TableHead>
                                <TableHead>{t('payouts.channel')}</TableHead>
                                <TableHead>{t('payouts.status')}</TableHead>
                                <TableHead>{t('payouts.createdAt')}</TableHead>
                                <TableHead>{t('payouts.note')}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {payouts?.map((payout: (typeof payouts extends undefined ? never : any[])[number]) => (
                                <TableRow key={payout.id}>
                                  <TableCell className='tabular-nums'>
                                    {formatCurrency(Number(payout.amount), 'CNY')}
                                  </TableCell>
                                  <TableCell>{channelLabel(payout.payoutChannel)}</TableCell>
                                  <TableCell>{statusLabel(payout.status)}</TableCell>
                                  <TableCell className='text-muted-foreground'>
                                    {payout.createdAt
                                      ? new Date(payout.createdAt).toLocaleString(dateLocale, { hour12: false })
                                      : t('payouts.empty')}
                                  </TableCell>
                                  <TableCell className='text-muted-foreground'>
                                    {payout.adminNote || t('payouts.empty')}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {/* 收益 / 账单 / 提现都是钱相关的历史，之前靠固定 limit
                              截断，用户看不到第 20 条之后的记录。 */}
                          <PaginationBox
                            page={payoutPage}
                            count={payoutsRes?.success ? (payoutsRes.total ?? 0) : 0}
                            pageSize={EARNINGS_PAGE_SIZE}
                            onPageChange={setPayoutPage}
                          />
                        </div>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card id='earnings-statements'>
                <CardHeader>
                  <CardTitle className='text-base'>{t('statements.title')}</CardTitle>
                  <CardDescription>
                    {t('statements.description')}
                    {timeline ? (
                      <span className='mt-1 block'>
                        {timeline.canConfirm
                          ? t('statements.deadlineHint', {
                              date: new Date(timeline.confirmDeadline).toLocaleDateString(dateLocale),
                            })
                          : t('statements.deadlinePassed')}
                      </span>
                    ) : null}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='grid gap-3 sm:grid-cols-4'>
                    {(
                      [
                        ['summaryPending', statements?.summary.pending ?? 0],
                        ['summaryConfirmed', statements?.summary.confirmed ?? 0],
                        ['summaryPaid', statements?.summary.paid ?? 0],
                        ['summaryRolled', statements?.summary.rolled ?? 0],
                      ] as const
                    ).map(([key, value]) => (
                      <div key={key} className='rounded-lg border p-3'>
                        <div className='text-muted-foreground text-xs'>{t(`statements.${key}`)}</div>
                        <div className='mt-1 font-semibold text-xl tabular-nums'>
                          {formatCurrency(value, 'CNY')}
                        </div>
                      </div>
                    ))}
                  </div>

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
                              {row.status === 'pending' ? (
                                <Button
                                  type='button'
                                  size='sm'
                                  disabled={!timeline?.canConfirm || confirmingId === row.id}
                                  onClick={() => {
                                    setConfirmingId(row.id)
                                    confirmStatement.mutate({ id: row.id })
                                  }}
                                >
                                  {confirmingId === row.id
                                    ? t('statements.confirming')
                                    : t('statements.confirm')}
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                        <PaginationBox
                          page={statementPage}
                          count={statements?.total ?? 0}
                          pageSize={EARNINGS_PAGE_SIZE}
                          onPageChange={setStatementPage}
                        />
                </CardContent>
              </Card>

              <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                {statCards.map((card) => (
                  <Card key={card.label}>
                    <CardHeader className='flex-row items-center justify-between space-y-0 pb-2'>
                      <CardTitle className='font-medium text-muted-foreground text-sm'>{card.label}</CardTitle>
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
                  <CardTitle id='earnings-gateway' className='text-base'>
                    {t('overview.title')}
                  </CardTitle>
                  <CardDescription>
                    {t('overview.perCall')}:{' '}
                    <span className='font-medium tabular-nums'>{formatCurrency(perCall, 'CNY')}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className='h-[260px] w-full' />
                  ) : error || !providerStats?.hasUsageData ? (
                    <div className='flex flex-col items-center gap-2 py-10 text-center'>
                      {error && <p className='text-destructive text-sm'>{t('loadFailed')}</p>}
                      {!error && <p className='text-muted-foreground text-sm'>{t('chart.empty')}</p>}
                      {error && (
                        <Button variant='outline' size='sm' onClick={() => refetch()}>
                          {t('retry')}
                        </Button>
                      )}
                    </div>
                  ) : chartData.length === 0 ? (
                    <div className='flex items-center justify-center py-10'>
                      <p className='text-muted-foreground text-sm'>{t('chart.empty')}</p>
                    </div>
                  ) : (
                    <ChartContainer config={chartConfig}>
                      <LineChart
                        accessibilityLayer
                        data={chartData}
                        margin={{ left: 12, right: 12 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey='date'
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tickFormatter={formatShortDate}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={({ active, payload, label }) => {
                            if (!active || !payload || payload.length === 0) return null

                            const dataRow = payload[0]?.payload as DailyUsage | undefined

                            return (
                              <div className='rounded-lg border bg-background p-3 shadow-sm'>
                                <div className='mb-2 font-medium text-sm'>
                                  {label
                                    ? new Date(label).toLocaleDateString(dateLocale, {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric',
                                      })
                                    : null}
                                </div>
                                <div className='flex flex-col gap-1.5'>
                                  <div className='flex justify-between gap-4'>
                                    <span className='text-muted-foreground text-sm'>{t('chart.calls')}:</span>
                                    <span className='font-medium text-sm'>
                                      {(dataRow?.calls ?? 0).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className='flex justify-between gap-4'>
                                    <span className='text-muted-foreground text-sm'>
                                      {t('chart.income')}:
                                    </span>
                                    <span className='font-medium text-sm'>
                                      {formatCurrency(dataRow?.spend ?? 0, 'CNY')}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )
                          }}
                        />
                        <Line dataKey='calls' type='linear' stroke='var(--color-calls)' strokeWidth={2} dot={false} />
                        <Line dataKey='spend' type='linear' stroke='var(--color-spend)' strokeWidth={2} dot={false} />
                      </LineChart>
                    </ChartContainer>
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
