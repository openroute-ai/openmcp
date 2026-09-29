'use client'

import { format } from 'date-fns'
import { Edit, Eye, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { trpc } from '@/lib/trpc/client'

interface AuthorTableProps {
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
    verified?: boolean
  }
  onFiltersChange: (newFilters: Partial<AuthorTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onUpdate: (author: any) => void
}

export function AuthorTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onUpdate,
}: AuthorTableProps) {
  const [localFilters, setLocalFilters] = useState(filters)

  const updateStatusMutation = trpc.admin.authors.updateAuthorStatus.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('状态更新成功')
        onRefresh()
      } else {
        toast.error(data.error || '状态更新失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '状态更新失败')
    },
  })

  const handleFilterChange = (key: string, value: string) => {
    const newFilters = { ...localFilters, [key]: value }
    setLocalFilters(newFilters)
    onFiltersChange(newFilters)
  }

  const handleStatusChange = (authorId: string, status: 'active' | 'inactive' | 'suspended') => {
    updateStatusMutation.mutate({ id: authorId, status })
  }

  const getStatusBadge = (status: string) => {
    const statusMap = {
      active: { label: '活跃', variant: 'default' as const },
      inactive: { label: '未激活', variant: 'secondary' as const },
      suspended: { label: '已暂停', variant: 'destructive' as const },
    }

    const config = statusMap[status as keyof typeof statusMap] || { label: status, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>作者列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          {/* 搜索和过滤 */}
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索作者...'
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
                <SelectItem value='active'>活跃</SelectItem>
                <SelectItem value='inactive'>未激活</SelectItem>
                <SelectItem value='suspended'>已暂停</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={localFilters.verified === undefined ? 'all' : localFilters.verified ? 'true' : 'false'}
              onValueChange={(value) =>
                handleFilterChange('verified', value === 'all' ? '' : value === 'true' ? 'true' : 'false')
              }
            >
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='验证状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部</SelectItem>
                <SelectItem value='true'>已验证</SelectItem>
                <SelectItem value='false'>未验证</SelectItem>
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
                <TableHead>作者</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>工作流数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>验证</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className='w-[70px]'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center'>
                    加载中...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center'>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data.map((author) => (
                  <TableRow key={author.id}>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        {author.avatar && (
                          <img src={author.avatar} alt={author.name} className='h-8 w-8 rounded-full' />
                        )}
                        <div>
                          <Link
                            href={`/admin/authors/${author.id}`}
                            className='font-medium text-primary hover:underline'
                          >
                            {author.name}
                          </Link>
                          {author.description && (
                            <div className='text-muted-foreground text-sm'>{author.description}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{author.username}</TableCell>
                    <TableCell>{author.workflowCount || 0}</TableCell>
                    <TableCell>{getStatusBadge(author.status)}</TableCell>
                    <TableCell>
                      {author.verified ? (
                        <Badge variant='default'>已验证</Badge>
                      ) : (
                        <Badge variant='outline'>未验证</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {author.createdAt ? format(new Date(author.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
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
                            <Link href={`/admin/authors/${author.id}`}>
                              <Eye className='mr-2 h-4 w-4' />
                              查看详情
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onUpdate(author)}>
                            <Edit className='mr-2 h-4 w-4' />
                            编辑
                          </DropdownMenuItem>
                          {author.status === 'active' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(author.id, 'inactive')}>
                              设为未激活
                            </DropdownMenuItem>
                          )}
                          {author.status === 'active' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(author.id, 'suspended')}>
                              暂停
                            </DropdownMenuItem>
                          )}
                          {author.status !== 'active' && (
                            <DropdownMenuItem onClick={() => handleStatusChange(author.id, 'active')}>
                              激活
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
