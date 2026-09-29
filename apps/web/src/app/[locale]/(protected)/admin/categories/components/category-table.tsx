'use client'

import { format } from 'date-fns'
import { Edit, Eye, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { trpc } from '@/lib/trpc/client'

interface CategoryTableProps {
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
    isActive?: boolean
  }
  onFiltersChange: (newFilters: Partial<CategoryTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onUpdate: (category: any) => void
}

export function CategoryTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onUpdate,
}: CategoryTableProps) {
  const [localFilters, setLocalFilters] = useState(filters)

  // 同步父组件的 filters 到本地状态
  useEffect(() => {
    setLocalFilters(filters)
  }, [filters])

  const updateStatusMutation = trpc.admin.categories.updateCategoryStatus.useMutation({
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
    let processedValue: string | boolean | undefined
    if (key === 'isActive') {
      // 处理状态筛选：'all' -> undefined, 'true' -> true, 'false' -> false
      processedValue = value === 'all' ? undefined : value === 'true'
    } else {
      // 处理搜索框：直接使用输入的字符串值
      processedValue = value
    }
    const newFilters = { ...localFilters, [key]: processedValue }
    setLocalFilters(newFilters)
    onFiltersChange(newFilters)
  }

  const handleStatusChange = (categoryId: string, isActive: boolean) => {
    updateStatusMutation.mutate({ id: categoryId, isActive })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>分类列表</CardTitle>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <Input
              placeholder='搜索分类...'
              value={localFilters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className='w-full sm:w-64'
            />
            <Select
              value={localFilters.isActive === undefined ? 'all' : localFilters.isActive ? 'true' : 'false'}
              onValueChange={(value) => handleFilterChange('isActive', value)}
            >
              <SelectTrigger className='w-full sm:w-32'>
                <SelectValue placeholder='状态' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='true'>激活</SelectItem>
                <SelectItem value='false'>未激活</SelectItem>
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
                <TableHead>分类名称</TableHead>
                <TableHead>标识符</TableHead>
                <TableHead>工作流数</TableHead>
                <TableHead>排序</TableHead>
                <TableHead>状态</TableHead>
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
                data.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/admin/categories/${category.id}`}
                          className='font-medium text-primary hover:underline'
                        >
                          {category.name}
                        </Link>
                        <div className='text-muted-foreground text-sm'>{category.nameEn}</div>
                      </div>
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{category.slug}</TableCell>
                    <TableCell>{category.workflowCount || 0}</TableCell>
                    <TableCell>{category.order || 0}</TableCell>
                    <TableCell>
                      {category.isActive ? (
                        <Badge variant='default'>激活</Badge>
                      ) : (
                        <Badge variant='secondary'>未激活</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {category.createdAt ? format(new Date(category.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
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
                            <Link href={`/admin/categories/${category.id}`}>
                              <Eye className='mr-2 h-4 w-4' />
                              查看详情
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onUpdate(category)}>
                            <Edit className='mr-2 h-4 w-4' />
                            编辑
                          </DropdownMenuItem>
                          {category.isActive ? (
                            <DropdownMenuItem onClick={() => handleStatusChange(category.id, false)}>
                              设为未激活
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleStatusChange(category.id, true)}>
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
