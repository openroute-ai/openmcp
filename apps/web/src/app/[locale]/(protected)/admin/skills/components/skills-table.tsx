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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { format } from 'date-fns'
import { Award, CheckCircle, MoreHorizontal, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc/client'

interface SkillsTableProps {
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
    certified?: boolean
  }
  onFiltersChange: (newFilters: Partial<SkillsTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onReview: (skill: any) => void
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'outline' | 'secondary' | 'destructive' | 'default'; className?: string }
> = {
  draft: { label: '草稿', variant: 'outline' },
  pending_review: {
    label: '待审核',
    variant: 'secondary',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  scanning: {
    label: '扫描中',
    variant: 'secondary',
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  },
  published: {
    label: '已上架',
    variant: 'secondary',
    className: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  },
  needs_revision: { label: '需修改', variant: 'outline' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已驳回', variant: 'destructive' },
}

export function SkillsTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onReview,
}: SkillsTableProps) {
  const [localFilters, setLocalFilters] = useState(filters)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    skillId: string | null
    action: 'publish' | 'unpublish' | 'delete' | null
    skillTitle: string
  }>({
    open: false,
    skillId: null,
    action: null,
    skillTitle: '',
  })

  const updateStatusMutation = trpc.admin.skills.updateSkillStatus.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('状态更新成功')
        onRefresh()
        setConfirmDialog({ open: false, skillId: null, action: null, skillTitle: '' })
      } else {
        toast.error(data.error || '状态更新失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '状态更新失败')
    },
  })

  const certifyMutation = trpc.admin.skills.certifySkill.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('认证状态已更新')
        onRefresh()
      } else {
        toast.error(data.error || '操作失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '操作失败')
    },
  })

  const rescanMutation = trpc.admin.skills.rescanSkill.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`重扫完成，安全评级：${data.grade || '-'}`)
        onRefresh()
      } else {
        toast.error(data.error || '重扫失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '重扫失败')
    },
  })

  const deleteMutation = trpc.admin.skills.deleteSkill.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('已删除 Skill')
        onRefresh()
        setConfirmDialog({ open: false, skillId: null, action: null, skillTitle: '' })
      } else {
        toast.error(data.error || '删除失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '删除失败')
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

  const openConfirm = (skill: any, action: 'publish' | 'unpublish' | 'delete') => {
    setConfirmDialog({ open: true, skillId: skill.id, action, skillTitle: skill.title })
  }

  const handleConfirm = () => {
    if (!confirmDialog.skillId || !confirmDialog.action) return
    if (confirmDialog.action === 'publish') {
      updateStatusMutation.mutate({ id: confirmDialog.skillId, status: 'published' })
    } else if (confirmDialog.action === 'unpublish') {
      updateStatusMutation.mutate({ id: confirmDialog.skillId, status: 'draft' })
    } else {
      deleteMutation.mutate({ id: confirmDialog.skillId })
    }
  }

  const statusLabel = (status: string) => {
    const config = STATUS_CONFIG[status] || { label: status, variant: 'outline' as const }
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skills 列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索标题/描述/作者...'
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
                <SelectItem value='pending_review'>待审核</SelectItem>
                <SelectItem value='scanning'>扫描中</SelectItem>
                <SelectItem value='needs_revision'>需修改</SelectItem>
                <SelectItem value='published'>已上架</SelectItem>
                <SelectItem value='draft'>草稿</SelectItem>
                <SelectItem value='archived'>已归档</SelectItem>
                <SelectItem value='rejected'>已驳回</SelectItem>
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
                <TableHead>标题</TableHead>
                <TableHead>作者</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>价格</TableHead>
                <TableHead>安全</TableHead>
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
                  <TableCell colSpan={10} className='h-24 text-center'>
                    加载中...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className='h-24 text-center'>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell>
                      <div className='font-medium'>{skill.title}</div>
                      {skill.slug && <div className='line-clamp-1 text-muted-foreground text-sm'>{skill.slug}</div>}
                    </TableCell>
                    <TableCell>
                      {skill.author?.name || '-'}
                      {skill.author?.verified ? '（已认证）' : ''}
                    </TableCell>
                    <TableCell>
                      {skill.sourceType === 'github' ? (
                        <Badge variant='outline'>GitHub</Badge>
                      ) : skill.sourceType ? (
                        <Badge variant='outline'>{skill.sourceType.toUpperCase()}</Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {skill.priceType === 'paid' ? (
                        <Badge variant='default'>付费</Badge>
                      ) : (
                        <Badge variant='secondary'>免费</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {skill.securityGrade ? (
                        <Badge
                          variant='outline'
                          className={
                            skill.securityGrade === 'safe'
                              ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                              : skill.securityGrade === 'caution'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                : skill.securityGrade === 'unsafe' || skill.securityGrade === 'reject'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                  : ''
                          }
                        >
                          {skill.securityGrade}
                        </Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{statusLabel(skill.status)}</TableCell>
                    <TableCell>
                      {skill.certified ? (
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
                        <div>浏览: {skill.views || 0}</div>
                        <div>下载: {skill.downloads || 0}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {skill.createdAt ? format(new Date(skill.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' className='h-8 w-8 p-0'>
                            <MoreHorizontal className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem onClick={() => onReview(skill)}>
                            <ShieldCheck className='mr-2 h-4 w-4' />
                            审核
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              certifyMutation.mutate({ id: skill.id, certified: !skill.certified })
                            }
                            disabled={certifyMutation.isPending}
                          >
                            <Award className='mr-2 h-4 w-4' />
                            {skill.certified ? '取消认证' : '标记认证'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => rescanMutation.mutate({ id: skill.id })}
                            disabled={rescanMutation.isPending}
                          >
                            <RefreshCw className='mr-2 h-4 w-4' />
                            重跑安全扫描
                          </DropdownMenuItem>
                          {skill.status !== 'archived' && skill.status !== 'published' && (
                            <DropdownMenuItem onClick={() => openConfirm(skill, 'publish')}>
                              <CheckCircle className='mr-2 h-4 w-4' />
                              上架
                            </DropdownMenuItem>
                          )}
                          {skill.status === 'published' && (
                            <DropdownMenuItem onClick={() => openConfirm(skill, 'unpublish')}>
                              <XCircle className='mr-2 h-4 w-4' />
                              取消上架
                            </DropdownMenuItem>
                          )}
                          {skill.status !== 'archived' && skill.status !== 'published' && (
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ id: skill.id, status: 'archived' })}>
                              归档
                            </DropdownMenuItem>
                          )}
                          {skill.status === 'archived' && (
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ id: skill.id, status: 'published' })}>
                              恢复上架
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className='text-destructive'
                            onClick={() => openConfirm(skill, 'delete')}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className='mr-2 h-4 w-4' />
                            删除
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

      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === 'publish'
                ? '确认上架 Skill'
                : confirmDialog.action === 'unpublish'
                  ? '确认取消上架 Skill'
                  : '确认删除 Skill'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'publish' &&
                `确定要上架 Skill"${confirmDialog.skillTitle}"吗？上架后将在 Skills 货架对用户可见。`}
              {confirmDialog.action === 'unpublish' &&
                `确定要取消上架 Skill"${confirmDialog.skillTitle}"吗？取消上架后将不再对用户可见。`}
              {confirmDialog.action === 'delete' &&
                `确定要删除 Skill"${confirmDialog.skillTitle}"吗？该操作不可恢复，将级联删除评分、扫描与安装记录。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={updateStatusMutation.isPending || deleteMutation.isPending}
              className={confirmDialog.action === 'delete' ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            >
              {updateStatusMutation.isPending || deleteMutation.isPending ? '处理中...' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}