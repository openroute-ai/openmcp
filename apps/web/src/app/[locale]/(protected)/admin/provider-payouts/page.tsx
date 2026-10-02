'use client'

import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
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

const STATEMENT_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  paid: '已打款',
  rolled: '负账单（滚入下月）',
}

/**
 * 待打款清单的一行，含可展开的明细。
 *
 * 抽成组件是因为明细表要展开成两行表格：把明细直接内联在 `<tr>` 里会让
 * `colSpan` 和 `border-b` 的样式互相干扰，收起/展开时整张表会错位。
 */
function StatementPayableRow(props: {
  row: {
    id: string
    authorId: string
    authorName: string | null
    authorUsername: string | null
    period: string
    currency: string
    payableAmount: number
    payoutChannel: string | null
    payoutAccount: string | null
    payoutDate: Date | string | null
    due: boolean
    status: string
  }
  busy: boolean
  reference: string
  detailOpen: boolean
  onToggleDetail: () => void
  onReferenceChange: (value: string) => void
  onMarkPaid: () => void
  onConfirm: () => void
}) {
  const { row } = props

  // 明细按需拉取：待打款清单可能几十行，财务绝大多数时候并不需要逐行核对，
  // 每次展开都请求会让首屏变慢。只有真正展开时才发请求。
  const detail = trpc.admin.providers.getStatementDetail.useQuery(
    { id: row.id },
    { enabled: props.detailOpen, retry: false, staleTime: 30_000 }
  )

  return (
    <>
      <tr className='border-b last:border-b-0'>
        <td className='px-3 py-2'>
          <div className='font-medium'>{row.authorName || row.authorUsername || row.authorId}</div>
          {row.payoutAccount ? (
            <div className='font-mono text-muted-foreground text-xs'>{row.payoutAccount}</div>
          ) : (
            <div className='text-destructive text-xs'>未绑定收款账号</div>
          )}
        </td>
        <td className='px-3 py-2'>
          {row.period}
          <div className='text-muted-foreground text-xs'>
            {STATEMENT_STATUS_LABELS[row.status] ?? row.status}
          </div>
        </td>
        <td className='px-3 py-2 font-medium tabular-nums'>
          {formatCurrency(row.payableAmount, row.currency)}
        </td>
        <td className='px-3 py-2 text-muted-foreground'>
          <div>{row.payoutDate ? formatDateTime(row.payoutDate) : '—'}</div>
          {row.due ? <div className='text-destructive text-xs'>已到期</div> : null}
        </td>
        <td className='px-3 py-2'>
          <input
            className='w-44 rounded-md border bg-background px-2 py-1 font-mono text-xs'
            placeholder='银行流水号 / 转账单号'
            value={props.reference}
            onChange={(e) => props.onReferenceChange(e.target.value)}
          />
        </td>
        <td className='px-3 py-2'>
          <div className='flex flex-wrap gap-1'>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={props.onToggleDetail}
              title='查看这张账单聚合了哪些收入行'
            >
              {props.detailOpen ? (
                <ChevronDown className='size-4' />
              ) : (
                <ChevronRight className='size-4' />
              )}
              明细
            </Button>
            {row.status === 'pending' ? (
              <Button
                type='button'
                size='sm'
                variant='secondary'
                disabled={props.busy}
                onClick={props.onConfirm}
              >
                代确认
              </Button>
            ) : null}
            <Button
              type='button'
              size='sm'
              disabled={
                props.busy ||
                !props.reference.trim() ||
                row.payableAmount <= 0 ||
                row.status !== 'confirmed'
              }
              onClick={props.onMarkPaid}
            >
              登记打款
            </Button>
          </div>
        </td>
      </tr>
      {props.detailOpen ? (
        <tr className='border-b bg-muted/20 last:border-b-0'>
          <td className='px-3 py-3' colSpan={6}>
            {detail.isLoading ? (
              <Skeleton className='h-24 w-full' />
            ) : detail.data?.success && detail.data.data ? (
              <StatementDetailPanel detail={detail.data.data} />
            ) : (
              <div className='py-4 text-center text-muted-foreground text-sm'>
                {detail.data?.error || '账单明细加载失败'}
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function StatementDetailPanel(props: {
  detail: {
    statement: {
      grossAmount: number
      platformFee: number
      netAmount: number
      carryoverAmount: number
      settlement: number
      payableAmount: number
      status: string
      payoutChannel: string | null
      payoutAccount: string | null
      confirmedAt: Date | string | null
      paidAt: Date | string | null
      payoutReference: string | null
    }
    earnings: Array<{
      id: string
      skillId: string | null
      kind: string
      grossAmount: number
      platformFee: number
      netAmount: number
      status: string
      createdAt: Date | string
    }>
  }
}) {
  const s = props.detail.statement
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-6 text-sm'>
        <div>
          <div className='text-muted-foreground text-xs'>当月净收入</div>
          <div className='font-medium tabular-nums'>{formatCurrency(s.netAmount)}</div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>上月抵扣</div>
          <div className='font-medium tabular-nums'>
            {s.carryoverAmount < 0 ? formatCurrency(-s.carryoverAmount) : '—'}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>本期结算</div>
          <div className='font-semibold tabular-nums'>{formatCurrency(s.settlement)}</div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs'>收款快照</div>
          <div className='font-medium'>
            {s.payoutChannel
              ? `${CHANNEL_LABELS[s.payoutChannel] ?? s.payoutChannel} ${s.payoutAccount ?? ''}`
              : '未绑定'}
          </div>
        </div>
        {s.payoutReference ? (
          <div>
            <div className='text-muted-foreground text-xs'>打款凭证</div>
            <div className='font-mono font-medium'>{s.payoutReference}</div>
          </div>
        ) : null}
      </div>
      <div className='overflow-x-auto rounded-md border bg-background'>
        <table className='w-full text-left text-xs'>
          <thead className='border-b bg-muted/40'>
            <tr>
              <th className='px-2 py-1.5 font-medium'>时间</th>
              <th className='px-2 py-1.5 font-medium'>类型</th>
              <th className='px-2 py-1.5 font-medium'>Skill</th>
              <th className='px-2 py-1.5 font-medium'>毛收入</th>
              <th className='px-2 py-1.5 font-medium'>平台费</th>
              <th className='px-2 py-1.5 font-medium'>净收入</th>
            </tr>
          </thead>
          <tbody>
            {props.detail.earnings.map((e) => (
              <tr key={e.id} className='border-b last:border-b-0'>
                <td className='px-2 py-1.5 text-muted-foreground'>{formatDateTime(e.createdAt)}</td>
                <td className='px-2 py-1.5'>{e.kind === 'clawback' ? '退款冲回' : '销售'}</td>
                <td className='px-2 py-1.5 font-mono text-muted-foreground'>{e.skillId ?? '—'}</td>
                <td className='px-2 py-1.5 tabular-nums'>{formatCurrency(e.grossAmount)}</td>
                <td className='px-2 py-1.5 tabular-nums'>{formatCurrency(e.platformFee)}</td>
                <td className='px-2 py-1.5 font-medium tabular-nums'>
                  {formatCurrency(e.netAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='text-muted-foreground text-xs'>
        收款账号是出账那一刻的快照。若创作者此后换绑账号，这张账单仍按上面的账号打款；
        需要改账号请先撤销账单再重新出账。
      </p>
    </div>
  )
}

export default function AdminProviderPayoutsPage() {
  const [status, setStatus] = useState<PayoutStatus | 'all'>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statementTab, setStatementTab] = useState<'payable' | 'all'>('payable')
  /**
   * 展开的账单明细行。只有一行可展开：财务对账时一次只看一张账单，同时展开
   * 多张会让两份明细的数字在视觉上混在一起，反而更容易看错。
   */
  const [openDetail, setOpenDetail] = useState<string | null>(null)
  // 打款凭证号必须人工回填：转账是线下动作，系统无法核实，只能靠流水号
  // 与银行/微信侧记录对上。所以这里是必填输入框而不是"标记已打款"按钮。
  const [reference, setReference] = useState<Record<string, string>>({})

  const unbilledQuery = trpc.admin.providers.unbilledEarnings.useQuery(undefined, { retry: false })
  const payableQuery = trpc.admin.providers.listPayableStatements.useQuery(undefined, { retry: false })
  // `listStatements` 的 input 虽有默认字段但整体仍可空，故显式传 `{}` 而不是
// `undefined`——传 `undefined` 会被 tRPC 的类型判成不可赋值。
  const statementsQuery = trpc.admin.providers.listStatements.useQuery(
    statementTab === 'payable' ? {} : { status: 'confirmed' as const },
    { retry: false }
  )

  const markPaid = trpc.admin.providers.markStatementPaid.useMutation({
    onSuccess: (result) => {
      setBusyId(null)
      if (result.success) {
        toast.success(result.alreadyPaid ? '该账单已登记打款' : '已登记打款')
        void payableQuery.refetch()
        void statementsQuery.refetch()
        void unbilledQuery.refetch()
      } else {
        toast.error(result.error || '登记打款失败')
      }
    },
    onError: (err) => {
      setBusyId(null)
      toast.error(err.message || '登记打款失败')
    },
  })

  const adminConfirm = trpc.admin.providers.confirmStatement.useMutation({
    onSuccess: (result) => {
      setBusyId(null)
      if (result.success) {
        toast.success('已代确认账单')
        void payableQuery.refetch()
        void statementsQuery.refetch()
      } else {
        toast.error(result.error || '确认失败')
      }
    },
    onError: (err) => {
      setBusyId(null)
      toast.error(err.message || '确认失败')
    },
  })

  const payableRows = payableQuery.data?.success ? payableQuery.data.data : []
  const unbilled = unbilledQuery.data?.success ? unbilledQuery.data.data : null

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
      <Card>
          <CardHeader className='flex-row items-start justify-between gap-4 space-y-0'>
            <div>
              <CardTitle className='text-base'>月度账单打款</CardTitle>
              <CardDescription>
                次月 5 日出账、19 日确认截止、20 日线下打款并回填凭证号。逾期未确认由 cron 自动确认。
              </CardDescription>
            </div>
            {unbilled ? (
              <div className='text-right text-sm'>
                <div className='text-muted-foreground text-xs'>未出账收入</div>
                <div className='font-semibold tabular-nums'>
                  {formatCurrency(unbilled.net, 'CNY')}
                  <span className='text-muted-foreground text-xs'>（{unbilled.count} 笔）</span>
                </div>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <Select
                value={statementTab}
                onValueChange={(v) => setStatementTab(v as 'payable' | 'all')}
              >
                <SelectTrigger className='w-44'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='payable'>待打款清单</SelectItem>
                  <SelectItem value='all'>已确认账单</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type='button'
                variant='outline'
                size='icon'
                onClick={() => {
                  void payableQuery.refetch()
                  void statementsQuery.refetch()
                }}
                disabled={payableQuery.isFetching || statementsQuery.isFetching}
              >
                <RefreshCw
                  className={`size-4 ${payableQuery.isFetching || statementsQuery.isFetching ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>

            {payableQuery.isLoading ? (
              <Skeleton className='h-40 w-full' />
            ) : statementTab === 'payable' ? (
              <div className='overflow-x-auto rounded-lg border'>
                <table className='w-full text-left text-sm'>
                  <thead className='border-b bg-muted/40'>
                    <tr>
<th className='px-3 py-2 font-medium'>作者</th>
                      <th className='px-3 py-2 font-medium'>结算月份</th>
                      <th className='px-3 py-2 font-medium'>应付金额</th>
                      <th className='px-3 py-2 font-medium'>打款日</th>
                      <th className='px-3 py-2 font-medium'>凭证号</th>
                      <th className='px-3 py-2 font-medium'>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payableRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className='px-3 py-10 text-center text-muted-foreground'>
                          暂无待打款账单
                        </td>
                      </tr>
                    ) : (
                      payableRows.map((row) => (
                        <StatementPayableRow
                          key={row.id}
                          row={row}
                          busy={busyId === row.id}
                          reference={reference[row.id] ?? ''}
                          detailOpen={openDetail === row.id}
                          onToggleDetail={() =>
                            setOpenDetail((prev) => (prev === row.id ? null : row.id))
                          }
                          onReferenceChange={(value) =>
                            setReference((prev) => ({ ...prev, [row.id]: value }))
                          }
                          onMarkPaid={() => {
                            setBusyId(row.id)
                            markPaid.mutate({ id: row.id, payoutReference: reference[row.id]!.trim() })
                          }}
                          onConfirm={() => {
                            setBusyId(row.id)
                            adminConfirm.mutate({ id: row.id })
                          }}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <table className='w-full text-left text-sm'>
                  <thead className='border-b bg-muted/40'>
                    <tr>
                      <th className='px-3 py-2 font-medium'>作者</th>
                      <th className='px-3 py-2 font-medium'>结算月份</th>
                      <th className='px-3 py-2 font-medium'>当月净收入</th>
                      <th className='px-3 py-2 font-medium'>上月抵扣</th>
                      <th className='px-3 py-2 font-medium'>本期结算</th>
                      <th className='px-3 py-2 font-medium'>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(statementsQuery.data?.success ? statementsQuery.data.data : []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className='px-3 py-10 text-center text-muted-foreground'>
                          暂无已确认账单
                        </td>
                      </tr>
                    ) : (
                      (statementsQuery.data?.success ? statementsQuery.data.data : []).map((row) => (
                        <tr key={row.id} className='border-b last:border-0'>
                          <td className='px-3 py-2'>
                            {row.authorName || row.authorUsername || row.authorId}
                          </td>
                          <td className='px-3 py-2'>{row.period}</td>
                          <td className='px-3 py-2 tabular-nums'>
                            {formatCurrency(row.netAmount, row.currency)}
                          </td>
                          <td className='px-3 py-2 tabular-nums'>
                            {row.carryoverAmount < 0
                              ? formatCurrency(-row.carryoverAmount, row.currency)
                              : '—'}
                          </td>
                          <td className='px-3 py-2 font-medium tabular-nums'>
                            {formatCurrency(row.settlement, row.currency)}
                          </td>
                          <td className='px-3 py-2 text-muted-foreground'>{row.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <RefundsCard />
      </div>
    </>
  )
}

/**
 * 退款区。
 *
 * 退款是真金白银的支出，且不可逆（余额已退、权益已撤销、创作者账单已出现负数
 * 行）。所以这里强制要求填写原因：创作者在账单里看到的负数行只有这一句解释，
 * 没有原因就无法申诉。金额默认全额，允许改小做部分退款。
 */
function RefundsCard() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'active' | 'revoked' | 'all'>('active')
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<{
    id: string
    label: string
    max: number
    reason: string
    amount: string
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const pageSize = 20
  const query = trpc.admin.providers.listRefundableEntitlements.useQuery(
    { status, search: search.trim() || undefined, limit: pageSize, offset: page * pageSize },
    { retry: false }
  )

  const refund = trpc.admin.providers.refundEntitlement.useMutation({
    onSuccess: (result) => {
      setBusyId(null)
      setPending(null)
      if (result.success) {
        toast.success(
          result.data?.clawbackSkipped
            ? '已退款（该笔销售未找到对应收入行，未生成冲回）'
            : '已退款'
        )
        void query.refetch()
      } else {
        toast.error(result.error || '退款失败')
      }
    },
    onError: (err) => {
      setBusyId(null)
      toast.error(err.message || '退款失败')
    },
  })

  const rows = query.data?.success ? query.data.data.list : []
  const total = query.data?.success ? query.data.data.total : 0
  const refundableTotal = query.data?.success ? query.data.data.refundableTotal : 0

  const submit = () => {
    if (!pending) return
    const reason = pending.reason.trim()
    if (!reason) {
      toast.error('请填写退款原因')
      return
    }
    const parsed = pending.amount.trim() === '' ? pending.max : Number(pending.amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('退款金额无效')
      return
    }
    // 部分退款：金额与全额不同才传 `amount`，否则走后端的全额路径。
    const isPartial = Math.abs(parsed - pending.max) > 0.005
    if (isPartial && parsed > pending.max + 0.005) {
      toast.error(`退款金额不能超过 ${pending.max}`)
      return
    }
    setBusyId(pending.id)
    refund.mutate({
      entitlementId: pending.id,
      reason,
      ...(isPartial ? { amount: Number(parsed.toFixed(2)) } : {}),
    })
  }

  return (
    <Card>
      <CardHeader className='flex-row items-start justify-between gap-4 space-y-0'>
        <div>
          <CardTitle className='text-base'>订单退款</CardTitle>
          <CardDescription>
            退款会撤销买家权益、把金额退回买家平台余额，并在创作者账单里生成一条负数冲回。
          </CardDescription>
        </div>
        <div className='text-right text-sm'>
          <div className='text-muted-foreground text-xs'>当前筛选可退金额</div>
          <div className='font-semibold tabular-nums'>{formatCurrency(refundableTotal, 'CNY')}</div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <input
            className='h-9 w-64 rounded-md border bg-background px-3 text-sm'
            placeholder='搜索买家邮箱 / Skill / 订单号'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
          <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(0) }}>
            <SelectTrigger className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='active'>可退款</SelectItem>
              <SelectItem value='revoked'>已退款</SelectItem>
              <SelectItem value='all'>全部</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type='button'
            variant='outline'
            size='icon'
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {query.isLoading ? (
          <Skeleton className='h-40 w-full' />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <table className='w-full text-left text-sm'>
              <thead className='border-b bg-muted/40'>
                <tr>
                  <th className='px-3 py-2 font-medium'>买家</th>
                  <th className='px-3 py-2 font-medium'>Skill</th>
                  <th className='px-3 py-2 font-medium'>金额</th>
                  <th className='px-3 py-2 font-medium'>可退</th>
                  <th className='px-3 py-2 font-medium'>状态</th>
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
                        <div className='font-medium'>{row.buyerEmail ?? row.userId}</div>
                        <div className='font-mono text-muted-foreground text-xs'>{row.orderId ?? row.id}</div>
                      </td>
                      <td className='px-3 py-2'>{row.skillName ?? row.skillId ?? '—'}</td>
                      <td className='px-3 py-2 tabular-nums'>{formatCurrency(row.amount, row.currency)}</td>
                      <td className='px-3 py-2 tabular-nums'>
                        {row.refundable > 0 ? formatCurrency(row.refundable, row.currency) : '—'}
                      </td>
                      <td className='px-3 py-2'>
                        <div>{row.status === 'active' ? '有效' : '已退款'}</div>
                        {row.revocationReason ? (
                          <div className='text-muted-foreground text-xs'>{row.revocationReason}</div>
                        ) : null}
                        {row.refundedBy ? (
                          <div className='text-muted-foreground text-xs'>操作人 {row.refundedBy}</div>
                        ) : null}
                      </td>
                      <td className='px-3 py-2'>
                        {row.status === 'active' && row.refundable > 0 ? (
                          <Button
                            type='button'
                            size='sm'
                            variant='secondary'
                            disabled={busyId === row.id}
                            onClick={() =>
                              setPending({
                                id: row.id,
                                label: `${row.skillName ?? row.skillId ?? row.id} · ${row.buyerEmail ?? row.userId}`,
                                max: row.refundable,
                                reason: '',
                                amount: '',
                              })
                            }
                          >
                            退款
                          </Button>
                        ) : (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className='flex items-center justify-between text-muted-foreground text-sm'>
          <span>共 {total} 条</span>
          <div className='flex gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={rows.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>

        {pending ? (
          <div className='space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4'>
            <div className='font-medium text-sm'>退款：{pending.label}</div>
            <div className='text-muted-foreground text-xs'>
              最多可退 {formatCurrency(pending.max)}。留空金额为全额退款；填入更小的金额为部分退款，
              创作者账单里只会按比例出现一条负数冲回。
            </div>
            <div className='flex flex-wrap items-end gap-3'>
              <div>
                <label className='mb-1 block text-xs'>退款金额</label>
                <input
                  className='h-9 w-40 rounded-md border bg-background px-3 font-mono text-sm'
                  placeholder={String(pending.max)}
                  value={pending.amount}
                  onChange={(e) => setPending({ ...pending, amount: e.target.value })}
                />
              </div>
              <div className='flex-1'>
                <label className='mb-1 block text-xs'>退款原因（必填，创作者可见）</label>
                <input
                  className='h-9 w-full rounded-md border bg-background px-3 text-sm'
                  placeholder='例如：Skill 无法正常使用 / 下架退款'
                  value={pending.reason}
                  onChange={(e) => setPending({ ...pending, reason: e.target.value })}
                />
              </div>
              <Button type='button' disabled={busyId === pending.id} onClick={submit}>
                确认退款
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={busyId === pending.id}
                onClick={() => setPending(null)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
