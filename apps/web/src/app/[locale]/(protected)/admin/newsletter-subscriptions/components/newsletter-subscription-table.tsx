'use client'

import { MailIcon, PencilIcon, TrashIcon, UsersIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { UpdateNewsletterSubscriptionDialog } from './update-newsletter-subscription-dialog'
import { DeleteNewsletterSubscriptionDialog } from './delete-newsletter-subscription-dialog'
import type { AdminNewsletterSubscriptionRow } from '../types'

interface NewsletterSubscriptionsTableProps {
  data: AdminNewsletterSubscriptionRow[]
  page: number
  pageSize: number
  total: number
  loading?: boolean
  /**
   * The delete mutation lives in the page, so this only flips true→false to
   * signal that the request settled. The table watches that edge to close its
   * own confirm dialog, keeping it mounted for the duration of the request.
   */
  deleting?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onConfirmDelete: (id: string) => void
  onUpdated: () => void | Promise<void>
}

const PAGE_SIZES = [20, 50, 100]

/**
 * Subscriber list.
 *
 * Row actions are wired to dialogs owned by this component so the page only
 * has to hand over a mutation callback; filters and paging stay in the page
 * because they drive the query.
 */
export function NewsletterSubscriptionsTable({
  data,
  page,
  pageSize,
  total,
  loading,
  deleting,
  onPageChange,
  onPageSizeChange,
  onConfirmDelete,
  onUpdated,
}: NewsletterSubscriptionsTableProps) {
  const [updateTarget, setUpdateTarget] = useState<AdminNewsletterSubscriptionRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminNewsletterSubscriptionRow | null>(null)

  // Close the confirm dialog once the page-owned mutation reports it is done.
  // Keyed on the settled edge rather than on a callback prop, so the table
  // stays in charge of the row it is confirming and the dialog cannot outlive
  // the request it is describing.
  const wasDeleting = useRef(false)
  useEffect(() => {
    if (wasDeleting.current && !deleting) setDeleteTarget(null)
    wasDeleting.current = Boolean(deleting)
  }, [deleting])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>来源</TableHead>
                <TableHead className='text-right'>已发邮件</TableHead>
                <TableHead>订阅时间</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center text-muted-foreground'>
                    加载中…
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center text-muted-foreground'>
                    暂无订阅记录
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className='font-medium'>
                      <span className='inline-flex items-center gap-1.5'>
                        <MailIcon className='h-3.5 w-3.5 text-muted-foreground' />
                        {row.email}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.user ? (
                        <span className='inline-flex items-center gap-1.5'>
                          <UsersIcon className='h-3.5 w-3.5 text-muted-foreground' />
                          {row.user.name || row.user.email || '—'}
                        </span>
                      ) : (
                        <span className='text-muted-foreground'>访客</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.subscribed ? (
                        <Badge>已订阅</Badge>
                      ) : (
                        <Badge variant='secondary'>已退订</Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>{row.source || '—'}</TableCell>
                    <TableCell className='text-right tabular-nums'>{row.emailSentCount}</TableCell>
                    <TableCell className='text-muted-foreground text-sm'>
                      {row.subscribedAt ? formatDateTime(row.subscribedAt) : '—'}
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 cursor-pointer'
                          aria-label='编辑订阅'
                          onClick={() => setUpdateTarget(row)}
                        >
                          <PencilIcon className='h-4 w-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 cursor-pointer text-destructive'
                          aria-label='删除订阅'
                          onClick={() => setDeleteTarget(row)}
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
        </CardContent>
      </Card>

      <div className='flex items-center justify-between'>
        <div className='text-muted-foreground text-sm'>
          共 {total.toLocaleString('zh-CN')} 条，第 {page} / {totalPages} 页
        </div>
        <div className='flex items-center gap-2'>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger size='sm' className='w-24 cursor-pointer'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} / 页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant='outline'
            size='sm'
            className='cursor-pointer'
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='cursor-pointer'
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      <UpdateNewsletterSubscriptionDialog
        open={updateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUpdateTarget(null)
        }}
        subscription={updateTarget}
        onSuccess={() => {
          setUpdateTarget(null)
          onUpdated()
        }}
      />

      <DeleteNewsletterSubscriptionDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
        subscription={deleteTarget}
        onConfirm={() => {
          if (deleteTarget) onConfirmDelete(deleteTarget.id)
        }}
        isLoading={deleting}
      />
    </>
  )
}
