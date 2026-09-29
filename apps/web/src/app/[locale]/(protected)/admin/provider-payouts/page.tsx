'use client'

import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { trpc } from '@/lib/trpc/client'
import { formatCurrency, formatDateTime } from '@/lib/utils/formatter'

type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'paid'

const STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已驳回',
  paid: '已打款',
}

const CHANNEL_LABELS: Record<string, string> = {
  wechat: '微信',
  alipay: '支付宝',
}

function statusLabel(status: string) {
  return STATUS_LABELS[status as PayoutStatus] ?? status
}

export default function AdminProviderPayoutsPage() {
  const [status, setStatus] = useState<PayoutStatus | 'all'>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)

  const queryInput = status === 'all' ? undefined : { status }
  const { data, isLoading, refetch, isFetching } = trpc.admin.providers.listPayoutRequests.useQuery(queryInput)

  const updateMutation = trpc.admin.providers.updatePayoutRequest.useMutation({
    onSuccess: (result) => {
      setBusyId(null)
      if (result.success) {
        toast.success('已更新')
        void refetch()
      } else {
        toast.error(result.error || '更新失败')
      }
    },
    onError: (err) => {
      setBusyId(null)
      toast.error(err.message || '更新失败')
    },
  })

  const rows = data?.success ? data.data : []

  const act = (id: string, next: 'approved' | 'rejected' | 'paid', adminNote?: string) => {
    setBusyId(id)
    updateMutation.mutate({ id, status: next, adminNote })
  }

  return (
    <>
      <DashboardHeader breadcrumbs={[{ label: 'Provider 提现', isCurrentPage: true }]} />
      <div className='flex-1 space-y-6 px-4 py-6 lg:px-6'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>Provider 提现审批</h1>
            <p className='mt-1 text-muted-foreground text-sm'>审核 Skill 销售分成的提现申请，并标记线下打款</p>
          </div>
          <div className='flex items-center gap-2'>
            <Select value={status} onValueChange={(v) => setStatus(v as PayoutStatus | 'all')}>
              <SelectTrigger className='w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部</SelectItem>
                <SelectItem value='pending'>待处理</SelectItem>
                <SelectItem value='approved'>已批准</SelectItem>
                <SelectItem value='rejected'>已驳回</SelectItem>
                <SelectItem value='paid'>已打款</SelectItem>
              </SelectContent>
            </Select>
            <Button type='button' variant='outline' size='icon' onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>提现列表</CardTitle>
            <CardDescription>批准后线下打款，再标记为已打款以核销可提现余额</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className='h-40 w-full' />
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <table className='w-full text-left text-sm'>
                  <thead className='border-b bg-muted/40'>
                    <tr>
                      <th className='px-3 py-2 font-medium'>作者</th>
                      <th className='px-3 py-2 font-medium'>金额</th>
                      <th className='px-3 py-2 font-medium'>渠道 / 账号</th>
                      <th className='px-3 py-2 font-medium'>状态</th>
                      <th className='px-3 py-2 font-medium'>申请时间</th>
                      <th className='px-3 py-2 font-medium'>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className='px-3 py-10 text-center text-muted-foreground'>
                          暂无记录
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.id} className='border-b last:border-0'>
                          <td className='px-3 py-2'>
                            <div className='font-medium'>{row.authorName || row.authorUsername || row.authorId}</div>
                            <div className='text-muted-foreground text-xs'>{row.userId}</div>
                          </td>
                          <td className='px-3 py-2 tabular-nums'>{formatCurrency(row.amount, row.currency || 'CNY')}</td>
                          <td className='px-3 py-2'>
                            <div>{row.payoutChannel ? CHANNEL_LABELS[row.payoutChannel] ?? row.payoutChannel : '—'}</div>
                            <div className='font-mono text-muted-foreground text-xs'>{row.payoutAccount || '—'}</div>
                          </td>
                          <td className='px-3 py-2'>
                            {statusLabel(row.status)}
                            {row.adminNote ? (
                              <div className='text-muted-foreground text-xs'>{row.adminNote}</div>
                            ) : null}
                          </td>
                          <td className='px-3 py-2 text-muted-foreground'>
                            {row.createdAt ? formatDateTime(row.createdAt) : '—'}
                          </td>
                          <td className='px-3 py-2'>
                            <div className='flex flex-wrap gap-1'>
                              {row.status === 'pending' ? (
                                <>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='secondary'
                                    disabled={busyId === row.id}
                                    onClick={() => act(row.id, 'approved')}
                                  >
                                    批准
                                  </Button>
                                  <Button
                                    type='button'
                                    size='sm'
                                    variant='outline'
                                    disabled={busyId === row.id}
                                    onClick={() => act(row.id, 'rejected', '不符合提现条件')}
                                  >
                                    驳回
                                  </Button>
                                </>
                              ) : null}
                              {row.status === 'approved' || row.status === 'pending' ? (
                                <Button
                                  type='button'
                                  size='sm'
                                  disabled={busyId === row.id}
                                  onClick={() => act(row.id, 'paid')}
                                >
                                  标记已打款
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
