'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers'
import { formatCurrency } from '@/lib/utils/formatter'
import { CreateRechargeOrderDialog } from './components/create-recharge-order-dialog'
import { RechargeOrderTable } from './components/recharge-order-table'
import { UpdateRechargeOrderDialog } from './components/update-recharge-order-dialog'

type RouterOutputs = inferRouterOutputs<AppRouter>
type AdminRechargeOrder = RouterOutputs['admin']['rechargeOrders']['getRechargeOrdersPaginated']['data'][number]

type OrderStatusFilter = 'all' | 'pending' | 'pending_transfer' | 'paid' | 'expired' | 'closed' | 'failed'
type PaymentMethodFilter = 'all' | 'alipay' | 'wechat' | 'bank_transfer' | 'recharge'

export default function RechargeOrderPage() {
  // 状态管理
  const [page, setPage] = useState(1)
  const [limit] = useState(10)

  // 本地状态管理
  const [selectedRechargeOrder, setSelectedRechargeOrder] = useState<AdminRechargeOrder | null>(null)
  const [filters, setFilters] = useState<{
    search: string
    userId?: string
    status: OrderStatusFilter
    paymentMethod: PaymentMethodFilter
  }>({
    search: '',
    userId: undefined,
    status: 'all',
    paymentMethod: 'all',
  })
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  // 防抖处理搜索条件
  const debouncedSearch = useDebounce(filters.search, 500)

  // tRPC queries
  const {
    data: rechargeOrdersData,
    isLoading: isLoadingRechargeOrders,
    refetch: refetchRechargeOrders,
  } = trpc.admin.rechargeOrders.getRechargeOrdersPaginated.useQuery({
    page,
    limit,
    search: debouncedSearch || undefined,
    userId: filters.userId,
    status: filters.status !== 'all' ? filters.status : undefined,
    paymentMethod: filters.paymentMethod !== 'all' ? filters.paymentMethod : undefined,
  })

  const {
    data: statsData,
    isLoading: isLoadingStatsData,
    refetch: refetchStats,
  } = trpc.admin.rechargeOrders.getRechargeOrderStats.useQuery()

  const rechargeOrders = rechargeOrdersData?.data ?? []
  const pagination = rechargeOrdersData?.pagination ?? { page, limit, total: 0, totalPages: 0 }
  const isLoading = isLoadingRechargeOrders
  const isLoadingStats = isLoadingStatsData

  // `sum(numeric)` comes back from Postgres as a string, so the money cards
  // need a number for the currency formatter.
  const stats = statsData?.data
  const statNumber = (value: number | string | null | undefined) => Number(value ?? 0)

  // 处理更新充值订单
  const handleUpdate = useCallback((order: AdminRechargeOrder) => {
    setSelectedRechargeOrder(order)
    setShowUpdateDialog(true)
  }, [])

  const handleCreateSuccess = useCallback(async () => {
    setShowCreateDialog(false)
    // 重新加载数据
    await Promise.all([refetchRechargeOrders(), refetchStats()])
    toast.success('创建成功')
  }, [refetchRechargeOrders, refetchStats])

  // 处理过滤条件变化
  const handleFiltersChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setPage(1) // 重置到第一页
  }, [])

  // 处理页面变化
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchRechargeOrders(), refetchStats()])
  }, [refetchRechargeOrders, refetchStats])

  return (
    <div className='space-y-6'>
      {/* 页面标题和操作按钮 */}
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>充值订单管理</h1>
          <p className='text-muted-foreground'>管理系统中的所有充值订单，包括订单状态和支付信息</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={handleRefresh}>
            <RefreshCw className='mr-2 h-4 w-4' />
            刷新
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className='mr-2 h-4 w-4' />
            创建充值订单
          </Button>
        </div>
      </div>

      {/* 统计信息 */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>总订单数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : statNumber(stats?.total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>待支付</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-1'>
              <div className='font-bold text-2xl'>
                {isLoadingStats ? '...' : formatCurrency(statNumber(stats?.pendingAmount), 'CNY')}
              </div>
              <div className='text-muted-foreground'>{isLoadingStats ? '...' : statNumber(stats?.pending)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已支付</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-1'>
              <div className='font-bold text-2xl'>
                {isLoadingStats ? '...' : formatCurrency(statNumber(stats?.paidAmount), 'CNY')}
              </div>
              <div className='text-muted-foreground'>{isLoadingStats ? '...' : statNumber(stats?.paid)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>总金额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>
              {isLoadingStats ? '...' : formatCurrency(statNumber(stats?.totalAmount), 'CNY')}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 充值订单列表 */}
      <RechargeOrderTable
        data={rechargeOrders}
        pagination={
          pagination || {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          }
        }
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onPageChange={handlePageChange}
        onUpdate={handleUpdate}
      />

      {/* 创建充值订单对话框 */}
      <CreateRechargeOrderDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
      />

      {/* 更新充值订单对话框 */}
      <UpdateRechargeOrderDialog
        // Remount per order so the form seeds from the newly selected row.
        key={selectedRechargeOrder?.id ?? 'none'}
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        rechargeOrder={selectedRechargeOrder}
        onSuccess={async () => {
          setShowUpdateDialog(false)
          setSelectedRechargeOrder(null)
          await Promise.all([refetchRechargeOrders(), refetchStats()])
        }}
      />
    </div>
  )
}
