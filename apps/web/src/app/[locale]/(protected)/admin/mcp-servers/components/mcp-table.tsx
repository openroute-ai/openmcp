'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { format } from 'date-fns'
import { CheckCircle, MoreHorizontal, ShieldCheck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc/client'

interface McpTableProps {
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
    status: string
    transport: string
    priceType: string
    certified?: boolean
  }
  onFiltersChange: (newFilters: Partial<McpTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onReview: (server: any) => void
}

export function McpTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onReview,
}: McpTableProps) {
  const [localFilters, setLocalFilters] = useState(filters)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    serverId: string | null
    action: 'publish' | 'unpublish' | null
    serverName: string
  }>({
    open: false,
    serverId: null,
    action: null,
    serverName: '',
  })

  const updateStatusMutation = trpc.admin.mcpServers.updateServerStatus.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('状态更新成功')
        onRefresh()
        setConfirmDialog({ open: false, serverId: null, action: null, serverName: '' })
      } else {
        toast.error(data.error || '状态更新失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '状态更新失败')
    },
  })

  const handleFilterChange = (key: string, value: string) => {
    const newFilters: any = { ...localFilters, [key]: value }
    if (key === 'certified' && value === 'all') {
      delete newFilters.certified
    } else if (key === 'certified') {
      newFilters.certified = value === 'true'
    }
    setLocalFilters(newFilters)
    onFiltersChange(newFilters)
  }

  const handleStatusChange = (
    serverId: string,
    status: 'draft' | 'submitted' | 'published' | 'archived' | 'rejected'
  ) => {
    updateStatusMutation.mutate({ id: serverId, status })
  }

  const handlePublishClick = (server: any) => {
    setConfirmDialog({
      open: true,
      serverId: server.id,
      action: 'publish',
      serverName: server.name,
    })
  }

  const handleUnpublishClick = (server: any) => {
    setConfirmDialog({
      open: true,
      serverId: server.id,
      action: 'unpublish',
      serverName: server.name,
    })
  }

  const handleConfirmStatusChange = () => {
    if (confirmDialog.serverId && confirmDialog.action) {
      const status = confirmDialog.action === 'publish' ? 'published' : 'draft'
      handleStatusChange(confirmDialog.serverId, status)
    }
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<
      string,
      { label: string; variant: 'outline' | 'secondary' | 'destructive' | 'default'; className?: string }
    > = {
      draft: { label: '草稿', variant: 'outline' },
      submitted: {
        label: '待审核',
        variant: 'secondary',
        className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
      },
      published: {
        label: '已上架',
        variant: 'secondary',
        className: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
      },
      archived: { label: '已归档', variant: 'outline' },
      rejected: { label: '已驳回', variant: 'destructive' },
    }
    const config = statusMap[status] || { label: status, variant: 'outline' as const }
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP Server 列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索服务/端点/作者...'
              value={localFilters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className='w-full sm:w-64'
            />
            <Select value={localFilters.status} onValueChange={(value) => handleFilterChange('status', value)}>
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='draft'>草稿</SelectItem>
                <SelectItem value='submitted'>待审核</SelectItem>
                <SelectItem value='published'>已上架</SelectItem>
                <SelectItem value='archived'>已归档</SelectItem>
                <SelectItem value='rejected'>已驳回</SelectItem>
              </SelectContent>
            </Select>
            <Select value={localFilters.transport} onValueChange={(value) => handleFilterChange('transport', value)}>
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='传输方式' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部传输</SelectItem>
                <SelectItem value='http'>HTTP</SelectItem>
                <SelectItem value='sse'>SSE</SelectItem>
                <SelectItem value='stdio'>Stdio</SelectItem>
              </SelectContent>
            </Select>
            <Select value={localFilters.priceType} onValueChange={(value) => handleFilterChange('priceType', value)}>
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='价格类型' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部</SelectItem>
                <SelectItem value='free'>免费</SelectItem>
                <SelectItem value='paid'>付费</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={localFilters.certified === undefined ? 'all' : String(localFilters.certified)}
              onValueChange={(value) => handleFilterChange('certified', value)}
            >
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='认证标记' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部认证</SelectItem>
                <SelectItem value='true'>已认证</SelectItem>
                <SelectItem value='false'>未认证</SelectItem>
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
                <TableHead>名称</TableHead>
                <TableHead>作者</TableHead>
                <TableHead>传输</TableHead>
                <TableHead>价格</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>认证标记</TableHead>
                <TableHead>统计</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className='w-[70px]'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className='h-24 text-center'>
                    加载中...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className='h-24 text-center'>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell>
                      <div className='font-medium'>{server.name}</div>
                      {server.endpoint && (
                        <div className='line-clamp-1 text-muted-foreground text-sm'>{server.endpoint}</div>
                      )}
                    </TableCell>
                    <TableCell>{server.author?.name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{server.transport.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      {server.priceType === 'paid' ? (
                        <Badge variant='default'>付费</Badge>
                      ) : (
                        <Badge variant='secondary'>免费</Badge>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(server.status)}</TableCell>
                    <TableCell>
                      {server.certified ? (
                        <Badge
                          variant='secondary'
                          className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                        >
                          已认证
                        </Badge>
                      ) : (
                        <Badge variant='outline'>未认证</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='text-sm'>
                        <div>浏览: {server.views || 0}</div>
                        <div>下载: {server.downloads || 0}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {server.createdAt ? format(new Date(server.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' className='h-8 w-8 p-0'>
                            <MoreHorizontal className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem onClick={() => onReview(server)}>
                            <ShieldCheck className='mr-2 h-4 w-4' />
                            审核
                          </DropdownMenuItem>
                          {server.status !== 'archived' && server.status !== 'published' && (
                            <DropdownMenuItem onClick={() => handlePublishClick(server)}>
                              <CheckCircle className='mr-2 h-4 w-4' />
                              上架
                            </DropdownMenuItem>
                          )}
                          {server.status === 'published' && (
                            <DropdownMenuItem onClick={() => handleUnpublishClick(server)}>
                              <XCircle className='mr-2 h-4 w-4' />
                              取消上架
                            </DropdownMenuItem>
                          )}
                          {server.status !== 'archived' && server.status !== 'published' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(server.id, 'archived')}>
                              归档
                            </DropdownMenuItem>
                          )}
                          {server.status === 'archived' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(server.id, 'published')}>
                              恢复上架
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      {/* 上架/取消上架确认对话框 */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === 'publish' ? '确认上架 MCP Server' : '确认取消上架 MCP Server'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'publish'
                ? `确定要上架服务"${confirmDialog.serverName}"吗？上架后将在 MCP 货架对用户可见。`
                : `确定要取消上架服务"${confirmDialog.serverName}"吗？取消上架后将不再对用户可见。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatusChange} disabled={updateStatusMutation.isPending}>
              {updateStatusMutation.isPending ? '处理中...' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
