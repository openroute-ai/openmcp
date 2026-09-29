'use client'

import { format } from 'date-fns'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'

interface ApplicationsTableProps {
  data: any[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  isLoading: boolean
  filters: {
    search: string
    verificationStatus: string
    payChannelStatus: string
  }
  onFiltersChange: (newFilters: Partial<ApplicationsTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onReview: (application: any) => void
}

export function ApplicationsTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onReview,
}: ApplicationsTableProps) {
  const [localFilters, setLocalFilters] = useState(filters)

  const handleFilterChange = (key: string, value: string) => {
    const newFilters = { ...localFilters, [key]: value }
    setLocalFilters(newFilters)
    onFiltersChange(newFilters)
  }

  const getVerificationBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      unverified: { label: '未提交', className: '' },
      pending: { label: '待审核', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
      verified: { label: '已通过', className: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
      rejected: { label: '已驳回', className: '' },
    }
    const config = map[status] || { label: status, className: '' }
    const variant: 'outline' | 'secondary' | 'destructive' =
      status === 'rejected' ? 'destructive' : status === 'unverified' ? 'outline' : 'secondary'
    return (
      <Badge variant={variant} className={config.className}>
        {config.label}
      </Badge>
    )
  }

  const getPayChannelBadge = (type: string | null, status: string | null) => {
    const channelLabel = type === 'wechat' ? '微信' : type === 'alipay' ? '支付宝' : '未开通'
    const statusMap: Record<string, { label: string; className?: string }> = {
      unconnected: { label: '未连接' },
      connecting: {
        label: '连接中',
        className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      },
      ready: { label: '可用', className: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
      error: { label: '异常', className: '' },
    }
    const config = statusMap[status || 'unconnected'] || { label: status || '未知' }
    return (
      <span className='inline-flex items-center gap-1.5'>
        <span className='font-medium text-sm'>{channelLabel}</span>
        <Badge
          variant={status === 'error' ? 'destructive' : status === 'ready' ? 'secondary' : 'outline'}
          className={config.className}
        >
          {config.label}
        </Badge>
      </span>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>入驻申请列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索申请人/邮箱/企业...'
              value={localFilters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className='w-full sm:w-64'
            />
            <Select
              value={localFilters.verificationStatus}
              onValueChange={(value) => handleFilterChange('verificationStatus', value)}
            >
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='认证状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='unverified'>未提交</SelectItem>
                <SelectItem value='pending'>待审核</SelectItem>
                <SelectItem value='verified'>已通过</SelectItem>
                <SelectItem value='rejected'>已驳回</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={localFilters.payChannelStatus}
              onValueChange={(value) => handleFilterChange('payChannelStatus', value)}
            >
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='收款状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部通道</SelectItem>
                <SelectItem value='unconnected'>未连接</SelectItem>
                <SelectItem value='connecting'>连接中</SelectItem>
                <SelectItem value='ready'>可用</SelectItem>
                <SelectItem value='error'>异常</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
                <TableHead>申请人</TableHead>
                <TableHead>主体</TableHead>
                <TableHead>收款通道</TableHead>
                <TableHead>认证状态</TableHead>
                <TableHead>提交时间</TableHead>
                <TableHead className='w-[70px]'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className='h-24 text-center'>
                    加载中...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className='h-24 text-center'>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>
                      <div className='font-medium'>{application.author?.name || application.account?.name || '-'}</div>
                      <div className='text-muted-foreground text-sm'>
                        {application.account?.email || `@${application.author?.username || '-'}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className='text-sm'>
                        <div>{application.entityType === 'company' ? '企业' : '个人'}</div>
                        {application.companyName && (
                          <div className='text-muted-foreground'>{application.companyName}</div>
                        )}
                        {application.contactName && (
                          <div className='text-muted-foreground'>联系人: {application.contactName}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getPayChannelBadge(application.payChannelType, application.payChannelStatus)}
                    </TableCell>
                    <TableCell>{getVerificationBadge(application.verificationStatus)}</TableCell>
                    <TableCell>
                      {application.createdAt ? format(new Date(application.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      <Button variant='outline' size='sm' onClick={() => onReview(application)}>
                        <ShieldCheck className='mr-1 h-3.5 w-3.5' />
                        审核
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

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
