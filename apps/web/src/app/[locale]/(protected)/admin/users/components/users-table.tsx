'use client'

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  MailCheckIcon,
  MailQuestionIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@workspace/ui/components/button'
import { Badge } from '@workspace/ui/components/badge'
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
import type { AdminUserRow, UserSortColumn } from '../types'

interface UsersTableProps {
  data: AdminUserRow[]
  total: number
  page: number
  pageSize: number
  loading?: boolean
  sort: UserSortColumn
  sortDesc: boolean
  onSortChange: (sort: UserSortColumn) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  /** Opens the ban / unban dialog for one row. */
  onBan: (user: AdminUserRow) => void
}

/** Columns that can be sorted server-side; matches the router's `sort` enum. */
const SORTABLE = new Set<string>(['name', 'email', 'role', 'createdAt'])

export function UsersTable({
  data,
  total,
  page,
  pageSize,
  loading,
  sort,
  sortDesc,
  onSortChange,
  onPageChange,
  onPageSizeChange,
  onBan,
}: UsersTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const renderSortIcon = (column: UserSortColumn) => {
    if (sort !== column) return <ArrowUpDownIcon className='h-3.5 w-3.5' />
    return sortDesc ? <ArrowDownIcon className='h-3.5 w-3.5' /> : <ArrowUpIcon className='h-3.5 w-3.5' />
  }

  const header = (column: UserSortColumn, label: string) =>
    SORTABLE.has(column) ? (
      <Button
        variant='ghost'
        size='sm'
        className='h-auto cursor-pointer gap-1.5 px-0 font-medium'
        onClick={() => onSortChange(column)}
      >
        {label}
        {renderSortIcon(column)}
      </Button>
    ) : (
      <span className='font-medium'>{label}</span>
    )

  return (
    <Card>
      <CardContent className='pt-6'>
        <div className='relative flex flex-col gap-4 overflow-auto'>
          <div className='overflow-hidden rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{header('name', '用户')}</TableHead>
                  <TableHead>{header('email', '邮箱')}</TableHead>
                  <TableHead>{header('role', '角色')}</TableHead>
                  <TableHead>{header('createdAt', '注册时间')}</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>封禁原因</TableHead>
                  <TableHead>封禁到期</TableHead>
                  <TableHead className='text-right'>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className='h-24 text-center'>
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className='h-24 text-center'>
                      暂无用户
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/admin/users/${row.id}`}
                          className='font-medium hover:underline hover:underline-offset-4'
                        >
                          {row.name || '未命名'}
                        </Link>
                        {row.phoneNumber && (
                          <p className='text-muted-foreground text-xs'>{row.phoneNumber}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant='outline'
                          className='cursor-pointer px-1.5 text-sm hover:bg-accent'
                          onClick={() => {
                            if (row.email) {
                              navigator.clipboard.writeText(row.email)
                            }
                          }}
                        >
                          {row.emailVerified ? (
                            <MailCheckIcon className='stroke-green-500 dark:stroke-green-400' />
                          ) : (
                            <MailQuestionIcon className='stroke-red-500 dark:stroke-red-400' />
                          )}
                          {row.email ?? '未设置'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.role === 'admin' ? 'default' : 'outline'} className='px-1.5'>
                          {row.role === 'admin' ? '管理员' : '用户'}
                        </Badge>
                      </TableCell>
                      <TableCell className='whitespace-nowrap'>{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant='outline' className='w-fit px-1.5'>
                          {row.banned ? (
                            <UserRoundXIcon className='stroke-red-500 dark:stroke-red-400' />
                          ) : (
                            <UserRoundCheckIcon className='stroke-green-500 dark:stroke-green-400' />
                          )}
                          {row.banned ? '已封禁' : '正常'}
                        </Badge>
                      </TableCell>
                      <TableCell className='max-w-48 truncate text-sm'>{row.banReason || '-'}</TableCell>
                      <TableCell className='whitespace-nowrap text-sm'>
                        {row.banExpires ? formatDateTime(row.banExpires) : '-'}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          <Button
                            variant={row.banned ? 'outline' : 'ghost'}
                            size='sm'
                            className='h-8 cursor-pointer px-3'
                            onClick={() => onBan(row)}
                          >
                            {row.banned ? '解除封禁' : '封禁'}
                          </Button>
                          <Link href={`/admin/users/${row.id}`}>
                            <Button variant='outline' size='sm' className='h-8 px-3'>
                              详情
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-sm'>
              共 {total.toLocaleString('zh-CN')} 位用户
            </p>
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
                  {[10, 20, 30, 50].map((size) => (
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
