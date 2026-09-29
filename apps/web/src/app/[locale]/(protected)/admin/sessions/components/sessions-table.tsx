'use client'

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClockIcon,
  EyeIcon,
  MonitorIcon,
  TrashIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { formatDateTime } from '@/lib/utils'
import type { AdminSessionRow } from '../types'

interface SessionsTableProps {
  data: AdminSessionRow[]
  page: number
  pageSize: number
  total: number
  loading?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onRevoke: (session: AdminSessionRow) => void
}

export function SessionsTable({
  data,
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  onPageSizeChange,
  onRevoke,
}: SessionsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Card>
      <CardContent className='pt-6'>
        <div className='relative flex flex-col gap-4 overflow-auto'>
          <div className='overflow-hidden rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>IP 地址</TableHead>
                  <TableHead>用户代理</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className='text-right'>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className='h-24 text-center'>
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className='h-24 text-center'>
                      暂无会话
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.userId ? (
                          <Link
                            href={`/admin/users/${row.userId}`}
                            className='font-medium hover:underline hover:underline-offset-4'
                          >
                            {row.userName || row.userEmail || '未命名用户'}
                          </Link>
                        ) : (
                          <span className='text-muted-foreground'>未知用户</span>
                        )}
                        {row.userEmail && row.userName && (
                          <p className='text-muted-foreground text-xs'>{row.userEmail}</p>
                        )}
                      </TableCell>
                      <TableCell className='font-mono text-sm'>{row.ipAddress ?? '-'}</TableCell>
                      <TableCell className='max-w-xs truncate text-sm' title={row.userAgent ?? ''}>
                        {row.userAgent || '-'}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-sm'>
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-sm'>
                        {formatDateTime(row.expiresAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline' className='w-fit px-1.5'>
                          {row.active ? (
                            <MonitorIcon className='h-3 w-3 text-green-500' />
                          ) : (
                            <ClockIcon className='h-3 w-3 text-muted-foreground' />
                          )}
                          {row.active ? '活跃' : '已过期'}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          <Link href={`/admin/sessions/${row.id}`}>
                            <Button variant='outline' size='icon' className='h-8 w-8 cursor-pointer' title='详情'>
                              <EyeIcon className='h-4 w-4' />
                            </Button>
                          </Link>
                          <Button
                            variant='outline'
                            size='icon'
                            className='h-8 w-8 cursor-pointer text-destructive'
                            title='吊销会话'
                            onClick={() => onRevoke(row)}
                          >
                            <TrashIcon className='h-4 w-4' />
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
            <p className='text-muted-foreground text-sm'>共 {total.toLocaleString('zh-CN')} 个会话</p>
            <div className='flex items-center gap-2'>
              <Select
                value={`${pageSize}`}
                onValueChange={(value) => {
                  onPageSizeChange(Number(value))
                  onPageChange(1)
                }}
              >
                <SelectTrigger size='sm' className='h-8 w-20 cursor-pointer' aria-label='每页条数'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 30, 50, 100].map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size} / 页
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant='outline'
                size='icon'
                className='h-8 w-8 cursor-pointer'
                onClick={() => onPageChange(1)}
                disabled={page <= 1}
                title='首页'
              >
                <ChevronsLeftIcon />
              </Button>
              <Button
                variant='outline'
                size='icon'
                className='h-8 w-8 cursor-pointer'
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
                title='上一页'
              >
                <ChevronLeftIcon />
              </Button>
              <span className='px-2 font-medium text-sm'>
                {page} / {totalPages}
              </span>
              <Button
                variant='outline'
                size='icon'
                className='h-8 w-8 cursor-pointer'
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
                title='下一页'
              >
                <ChevronRightIcon />
              </Button>
              <Button
                variant='outline'
                size='icon'
                className='h-8 w-8 cursor-pointer'
                onClick={() => onPageChange(totalPages)}
                disabled={page >= totalPages}
                title='末页'
              >
                <ChevronsRightIcon />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
