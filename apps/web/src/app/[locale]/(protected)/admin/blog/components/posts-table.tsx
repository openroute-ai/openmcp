'use client'

import { Edit, RefreshCw, Search, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'

interface Post {
  id: string
  title: string
  slug: string
  locale: string
  published: boolean | null
  date: Date
  author?: {
    name: string
    avatar: string
  } | null
}

interface PostsTableProps {
  data: Post[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  isLoading: boolean
  filters: {
    search: string
    locale?: string
    published?: boolean
  }
  onFiltersChange: (filters: Partial<PostsTableProps['filters']>) => void
  onPageChange: (page: number) => void
  onRefresh: () => void
  onDelete: (post: { id: string; title: string }) => void
}

export function PostsTable({
  data,
  pagination,
  isLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onDelete,
}: PostsTableProps) {
  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-4'>
        <div className='flex-1'>
          <div className='relative'>
            <Search className='absolute top-2.5 left-2 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='搜索文章...'
              value={filters.search}
              onChange={(e) => onFiltersChange({ search: e.target.value })}
              className='pl-8'
            />
          </div>
        </div>
        <Select
          value={filters.locale || 'all'}
          onValueChange={(value) => onFiltersChange({ locale: value === 'all' ? undefined : value })}
        >
          <SelectTrigger className='w-[180px]'>
            <SelectValue placeholder='选择语言' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>所有语言</SelectItem>
            <SelectItem value='zh'>中文</SelectItem>
            <SelectItem value='en'>English</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.published === undefined ? 'all' : filters.published ? 'published' : 'unpublished'}
          onValueChange={(value) => onFiltersChange({ published: value === 'all' ? undefined : value === 'published' })}
        >
          <SelectTrigger className='w-[180px]'>
            <SelectValue placeholder='选择状态' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>所有状态</SelectItem>
            <SelectItem value='published'>已发布</SelectItem>
            <SelectItem value='unpublished'>未发布</SelectItem>
          </SelectContent>
        </Select>
        <Button variant='outline' size='icon' onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead>作者</TableHead>
              <TableHead>语言</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>发布日期</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className='text-center'>
                  加载中...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-center'>
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              data.map((post) => (
                <TableRow key={post.id}>
                  <TableCell className='font-medium'>{post.title}</TableCell>
                  <TableCell>{post.author?.name || '-'}</TableCell>
                  <TableCell>
                    <Badge variant='outline'>{post.locale}</Badge>
                  </TableCell>
                  <TableCell>
                    {(post.published ?? false) ? (
                      <Badge variant='default'>已发布</Badge>
                    ) : (
                      <Badge variant='secondary'>未发布</Badge>
                    )}
                  </TableCell>
                  <TableCell>{new Date(post.date).toLocaleDateString()}</TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      <Button variant='ghost' size='icon' asChild>
                        <Link href={`/admin/blog/posts/${post.id}/edit`}>
                          <Edit className='h-4 w-4' />
                        </Link>
                      </Button>
                      <Button variant='ghost' size='icon' onClick={() => onDelete({ id: post.id, title: post.title })}>
                        <Trash2 className='h-4 w-4 text-destructive' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-between'>
        <div className='text-muted-foreground text-sm'>
          共 {pagination.total} 条，第 {pagination.page} / {pagination.totalPages} 页
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
          >
            上一页
          </Button>
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
    </div>
  )
}
