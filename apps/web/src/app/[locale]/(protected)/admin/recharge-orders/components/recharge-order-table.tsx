'use client'

import { format } from 'date-fns'
import { Edit, MoreHorizontal } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers'

type RouterOutputs = inferRouterOutputs<AppRouter>
type AdminRechargeOrder = RouterOutputs['admin']['rechargeOrders']['getRechargeOrdersPaginated']['data'][number]

/** Filter vocabularies mirror `admin.rechargeOrders.getRechargeOrdersPaginated`. */
type OrderStatusFilter = 'all' | 'pending' | 'pending_transfer' | 'paid' | 'expired' | 'closed' | 'failed'
type PaymentMethodFilter = 'all' | 'alipay' | 'wechat' | 'bank_transfer' | 'recharge'

interface RechargeOrderTableProps {
  data: AdminRechargeOrder[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  isLoading: boolean
  filters: {
    search: string
    userId?: string
    status: OrderStatusFilter
    paymentMethod: PaymentMethodFilter
  }
  onFiltersChange: (newFilters: Partial<RechargeOrderTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onUpdate: (order: AdminRechargeOrder) => void
}

export function RechargeOrderTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onUpdate,
}: RechargeOrderTableProps) {
  const handleFilterChange = <K extends 'search' | 'status' | 'paymentMethod'>(
    key: K,
    value: RechargeOrderTableProps['filters'][K]
  ) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const getStatusBadge = (status: string) => {
    const statusMap = {
      pending: { label: '待支付', variant: 'outline' as const },
      pending_transfer: { label: '待对账', variant: 'outline' as const },
      paid: { label: '已支付', variant: 'default' as const },
      failed: { label: '支付失败', variant: 'destructive' as const },
      expired: { label: '已过期', variant: 'secondary' as const },
      closed: { label: '已关闭', variant: 'secondary' as const },
    }

    const config = statusMap[status as keyof typeof statusMap] || { label: status, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const getPaymentMethodBadge = (method: string) => {
    const methodMap = {
      alipay: { label: '支付宝', variant: 'default' as const },
      wechat: { label: '微信支付', variant: 'secondary' as const },
      bank_transfer: { label: '银行转账', variant: 'outline' as const },
      gifted: { label: '平台赠送', variant: 'outline' as const },
    }

    const config = methodMap[method as keyof typeof methodMap] || { label: method, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>充值订单列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          {/* 搜索和过滤 */}
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索订单...'
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className='w-full sm:w-64'
            />
            <Select value={filters.status} onValueChange={(value) => handleFilterChange('status', value as OrderStatusFilter)}>
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='pending'>待支付</SelectItem>
                <SelectItem value='pending_transfer'>待对账</SelectItem>
                <SelectItem value='paid'>已支付</SelectItem>
                <SelectItem value='failed'>支付失败</SelectItem>
                <SelectItem value='expired'>已过期</SelectItem>
                <SelectItem value='closed'>已关闭</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.paymentMethod}
              onValueChange={(value) => handleFilterChange('paymentMethod', value as PaymentMethodFilter)}
            >
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='支付方式' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部方式</SelectItem>
                <SelectItem value='alipay'>支付宝</SelectItem>
                <SelectItem value='wechat'>微信支付</SelectItem>
                <SelectItem value='bank_transfer'>银行转账</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 分页信息 */}
          <div className='text-muted-foreground text-sm'>
            共 {pagination.total} 条记录，第 {pagination.page} / {pagination.totalPages} 页
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>订单号</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>支付方式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>过期时间</TableHead>
                <TableHead className='w-[70px]'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className='h-24 text-center'>
                    加载中...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className='h-24 text-center'>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className='font-mono text-sm'>{order.orderId}</TableCell>
                    <TableCell>
                      <div className='font-medium'>{order.userName || '未知用户'}</div>
                      <div className='text-muted-foreground text-sm'>{order.userEmail || '无邮箱'}</div>
                    </TableCell>
                    <TableCell>
                      <div className='font-medium'>¥{order.amount}</div>
                      <div className='text-muted-foreground text-sm'>{order.currency}</div>
                    </TableCell>
                    <TableCell>{getPaymentMethodBadge(order.paymentMethod)}</TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                    <TableCell>
                      {order.createdAt ? format(new Date(order.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      {order.expiresAt ? format(new Date(order.expiresAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' className='h-8 w-8 p-0'>
                            <MoreHorizontal className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem onClick={() => onUpdate(order)}>
                            <Edit className='mr-2 h-4 w-4' />
                            编辑
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* 分页 */}
        {pagination.totalPages > 1 && (
          <div className='flex items-center justify-between space-x-2 py-4'>
            <div className='text-muted-foreground text-sm'>
              显示第 {(pagination.page - 1) * pagination.limit + 1} -{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} 条，共 {pagination.total} 条
            </div>
            <div className='flex items-center space-x-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => onPageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
              >
                上一页
              </Button>
              <div className='flex items-center space-x-1'>
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  const pageNum = i + 1
                  return (
                    <Button
                      key={pageNum}
                      variant={pagination.page === pageNum ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => onPageChange(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  )
                })}
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => onPageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
