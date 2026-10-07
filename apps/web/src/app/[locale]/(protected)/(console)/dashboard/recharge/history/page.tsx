'use client'

import { useEffect, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Badge } from '@workspace/ui/components/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { useTranslations } from 'next-intl'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import DateRangePicker from '@/components/web/date-range-picker'
import EmptyStates from '@/components/web/empty-states'
import LoadingSpinner from '@/components/web/loading-spinner'
import PaginationBox from '@/components/web/pagination-box'
import { trpc } from '@/lib/trpc/client'
import { formatDate } from '@/lib/utils'

const getRechargeType = (type: string) => {
  return type === 'recharge' ? '余额充值' : '积分充值'
}

export default function ExpenseCenter() {
  const t = useTranslations('RechargePage')
  const tDashboard = useTranslations('Dashboard')
  // 状态管理
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30天前
    to: new Date(Date.now() + 24 * 60 * 60 * 1000), // 明天
  })
  const [shouldLoadData, setShouldLoadData] = useState(false)

  // TRPC query - 只有当 shouldLoadData 为 true 时才启用查询
  const { data: rechargeHistoryData, isLoading: isLoadingRechargeHistory } = trpc.recharge.getRechargeHistory.useQuery(
    {
      page: currentPage,
      pageSize: pageSize ?? undefined,
      startDate: dateRange?.from?.toISOString().split('T')[0] ?? undefined,
      endDate: dateRange?.to?.toISOString().split('T')[0] ?? undefined,
    },
    {
      enabled: shouldLoadData, // 只有在 shouldLoadData 为 true 时才执行查询
    }
  )

  // 组件挂载后，标记为可以加载数据
  useEffect(() => {
    setShouldLoadData(true)
  }, [])

  // 处理分页变化
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // 处理日期范围变化
  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
    // 日期范围变化时，如果数据还未加载，则开始加载
    if (!shouldLoadData) {
      setShouldLoadData(true)
    }
  }

  const breadcrumbs = [
    { label: tDashboard('dashboard.title'), href: '/dashboard' },
    { label: t('title'), href: '/dashboard/recharge' },
    { label: t('viewHistory'), isCurrentPage: true },
  ]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto flex w-full max-w-7xl flex-1 flex-col'>
          {!shouldLoadData ? (
            <>
              <div className='flex flex-row items-center gap-4 border-b py-5'>
                <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
              </div>
              <div className='flex flex-1 items-center justify-center'>
                <EmptyStates title='准备加载' description='请选择日期范围后查看充值记录' />
              </div>
            </>
          ) : (
            <>
              <div className='flex flex-row items-center gap-4 border-b py-5'>
                <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
              </div>

              {/* 加载状态和错误处理 */}
              {isLoadingRechargeHistory ? (
                <LoadingSpinner />
              ) : !rechargeHistoryData?.data?.records || rechargeHistoryData.data.records.length === 0 ? (
                <EmptyStates title='暂无充值记录' description='您还没有任何充值记录' />
              ) : (
                <>
                  <div className='flex-1 overflow-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow className='h-[52px]'>
                          <TableHead>日期</TableHead>
                          <TableHead>充值金额（元）</TableHead>
                          <TableHead>积分数量</TableHead>
                          <TableHead>渠道</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>备注</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rechargeHistoryData?.data?.records?.map((row) => (
                          <TableRow className='h-[52px]' key={row.id}>
                            <TableCell>{formatDate(new Date(row.date))}</TableCell>
                            <TableCell>{row.amount}</TableCell>
                            <TableCell>
                              {row.credits && Number.parseFloat(String(row.credits)) > 0
                                ? Number.parseFloat(String(row.credits)).toFixed(2)
                                : '-'}
                            </TableCell>
                            <TableCell>{row.channel}</TableCell>
                            <TableCell>{getRechargeType(row.type)}</TableCell>
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
                                {row.status === 'completed' ? '已完成' : row.status === 'processing' ? '处理中' : '失败'}
                              </Badge>
                            </TableCell>
                            <TableCell>{row.remark}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <PaginationBox
                    page={currentPage}
                    count={rechargeHistoryData?.data?.total || 0}
                    pageSize={rechargeHistoryData?.data?.pageSize || 0}
                    onPageChange={handlePageChange}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
