'use client'

import { format } from 'date-fns'
import { CheckCircle, Edit, Eye, MoreHorizontal, Shield, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { trpc } from '@/lib/trpc/client'
import { CertificationDialog } from './certification-dialog'

interface WorkflowTableProps {
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
    priceType: string
    complexity: string
    certified?: boolean
    authorId?: string
  }
  onFiltersChange: (newFilters: Partial<WorkflowTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onUpdate: (workflow: any) => void
}

export function WorkflowTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onUpdate,
}: WorkflowTableProps) {
  const [localFilters, setLocalFilters] = useState(filters)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    workflowId: string | null
    action: 'publish' | 'unpublish' | null
    workflowTitle: string
  }>({
    open: false,
    workflowId: null,
    action: null,
    workflowTitle: '',
  })
  const [certificationDialog, setCertificationDialog] = useState<{
    open: boolean
    workflow: any | null
  }>({
    open: false,
    workflow: null,
  })

  const updateStatusMutation = trpc.admin.workflows.updateWorkflowStatus.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('状态更新成功')
        onRefresh()
        setConfirmDialog({ open: false, workflowId: null, action: null, workflowTitle: '' })
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

  const handleStatusChange = (workflowId: string, status: 'draft' | 'published' | 'archived' | 'rejected') => {
    updateStatusMutation.mutate({ id: workflowId, status })
  }

  const handlePublishClick = (workflow: any) => {
    setConfirmDialog({
      open: true,
      workflowId: workflow.id,
      action: 'publish',
      workflowTitle: workflow.title,
    })
  }

  const handleUnpublishClick = (workflow: any) => {
    setConfirmDialog({
      open: true,
      workflowId: workflow.id,
      action: 'unpublish',
      workflowTitle: workflow.title,
    })
  }

  const handleConfirmStatusChange = () => {
    if (confirmDialog.workflowId && confirmDialog.action) {
      const status = confirmDialog.action === 'publish' ? 'published' : 'draft'
      handleStatusChange(confirmDialog.workflowId, status)
    }
  }

  const handleCertificationClick = (workflow: any) => {
    setCertificationDialog({
      open: true,
      workflow,
    })
  }

  const getStatusBadge = (status: string) => {
    const statusMap = {
      draft: { label: '草稿', variant: 'secondary' as const },
      published: { label: '已发布', variant: 'default' as const },
      archived: { label: '已归档', variant: 'outline' as const },
      rejected: { label: '已拒绝', variant: 'destructive' as const },
    }

    const config = statusMap[status as keyof typeof statusMap] || { label: status, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const getPriceTypeBadge = (priceType: string) => {
    if (priceType === 'paid') {
      return <Badge variant='default'>付费</Badge>
    }
    return <Badge variant='secondary'>免费</Badge>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>工作流列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索工作流...'
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
                <SelectItem value='published'>已发布</SelectItem>
                <SelectItem value='archived'>已归档</SelectItem>
                <SelectItem value='rejected'>已拒绝</SelectItem>
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
            <Select value={localFilters.complexity} onValueChange={(value) => handleFilterChange('complexity', value)}>
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='复杂度' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部</SelectItem>
                <SelectItem value='beginner'>初级</SelectItem>
                <SelectItem value='intermediate'>中级</SelectItem>
                <SelectItem value='advanced'>高级</SelectItem>
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
                <TableHead>标题</TableHead>
                <TableHead>作者</TableHead>
                <TableHead>价格类型</TableHead>
                <TableHead>复杂度</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>认证</TableHead>
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
                data.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/admin/workflows/${workflow.id}`}
                          className='font-medium text-primary hover:underline'
                        >
                          {workflow.title}
                        </Link>
                        {workflow.description && (
                          <div className='line-clamp-1 text-muted-foreground text-sm'>{workflow.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {workflow.author ? (
                        <Link href={`/admin/authors/${workflow.author.id}`} className='text-primary hover:underline'>
                          {workflow.author.name}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{getPriceTypeBadge(workflow.priceType)}</TableCell>
                    <TableCell>
                      {workflow.complexity ? <Badge variant='outline'>{workflow.complexity}</Badge> : '-'}
                    </TableCell>
                    <TableCell>{getStatusBadge(workflow.status)}</TableCell>
                    <TableCell>
                      {workflow.certified ? (
                        <Badge variant='default'>已认证</Badge>
                      ) : (
                        <Badge variant='outline'>未认证</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='text-sm'>
                        <div>浏览: {workflow.views || 0}</div>
                        <div>下载: {workflow.downloads || 0}</div>
                        <div>点赞: {workflow.likes || 0}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {workflow.createdAt ? format(new Date(workflow.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' className='h-8 w-8 p-0'>
                            <MoreHorizontal className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/workflows/${workflow.id}`}>
                              <Eye className='mr-2 h-4 w-4' />
                              查看详情
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onUpdate(workflow)}>
                            <Edit className='mr-2 h-4 w-4' />
                            编辑
                          </DropdownMenuItem>
                          {workflow.status !== 'archived' && (
                            <>
                              {workflow.status !== 'published' && (
                                <DropdownMenuItem onClick={() => handlePublishClick(workflow)}>
                                  <CheckCircle className='mr-2 h-4 w-4' />
                                  发布
                                </DropdownMenuItem>
                              )}
                              {workflow.status === 'published' && (
                                <DropdownMenuItem onClick={() => handleUnpublishClick(workflow)}>
                                  <XCircle className='mr-2 h-4 w-4' />
                                  取消发布
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleCertificationClick(workflow)}>
                                <Shield className='mr-2 h-4 w-4' />
                                认证审核
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(workflow.id, 'archived')}>
                                归档
                              </DropdownMenuItem>
                            </>
                          )}
                          {workflow.status === 'archived' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(workflow.id, 'published')}>
                              恢复发布
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

      {/* 发布/取消发布确认对话框 */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === 'publish' ? '确认发布工作流' : '确认取消发布工作流'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'publish'
                ? `确定要发布工作流"${confirmDialog.workflowTitle}"吗？发布后工作流将对用户可见。`
                : `确定要取消发布工作流"${confirmDialog.workflowTitle}"吗？取消发布后工作流将不再对用户可见。`}
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

      {/* 认证审核对话框 */}
      <CertificationDialog
        open={certificationDialog.open}
        onOpenChange={(open) => setCertificationDialog({ ...certificationDialog, open })}
        workflow={certificationDialog.workflow}
        onSuccess={() => {
          setCertificationDialog({ open: false, workflow: null })
          onRefresh()
        }}
      />
    </Card>
  )
}
