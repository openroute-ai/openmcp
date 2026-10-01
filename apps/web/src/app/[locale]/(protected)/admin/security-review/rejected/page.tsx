'use client'

import { Loader2Icon, ShieldXIcon } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils'
import { toFlags, type ReviewRecord } from '../types'

/**
 * Rejected submissions.
 *
 * One row per skill: the router collapses repeated review rows and keeps the
 * newest, so a skill that was auto-rejected and then manually rejected appears
 * once rather than twice.
 */
export default function RejectedReviewsPage() {
  const { data, isLoading } = trpc.admin.securityReview.getRejected.useQuery()
  const records = (data?.success ? data.data : []) as ReviewRecord[]

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='flex items-center gap-2 font-bold text-2xl'>
          <ShieldXIcon className='size-6 text-destructive' />
          驳回记录
        </h1>
        <p className='text-muted-foreground'>
          被自动扫描或人工审核驳回的 Skill。可以通过详情页恢复到复核队列。
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className='flex items-center justify-center gap-2 py-16 text-muted-foreground'>
            <Loader2Icon className='size-5 animate-spin' />
            加载中...
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className='py-16 text-center text-muted-foreground'>暂无驳回记录</CardContent>
        </Card>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>创作者</TableHead>
                <TableHead>规则评级</TableHead>
                <TableHead>命中 flag</TableHead>
                <TableHead>驳回类型</TableHead>
                <TableHead>审核人</TableHead>
                <TableHead>时间</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <p className='font-medium text-sm'>{record.title}</p>
                    <p className='font-mono text-muted-foreground text-xs'>{record.slug}</p>
                  </TableCell>
                  <TableCell className='text-sm'>{record.authorName}</TableCell>
                  <TableCell>
                    <Badge variant='outline'>{record.scanGrade ?? '—'}</Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    {toFlags(record.flags).length > 0
                      ? toFlags(record.flags)
                          .slice(0, 2)
                          .map((flag) => flag.name)
                          .join('、')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={record.reviewType === 'auto_reject' ? 'destructive' : 'outline'}>
                      {record.reviewType === 'auto_reject' ? '自动驳回' : '人工驳回'}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-sm'>{record.reviewerName || '系统'}</TableCell>
                  <TableCell className='whitespace-nowrap text-sm'>
                    {formatDateTime(record.createdAt)}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Link href={`/admin/security-review/${record.id}`}>
                      <Button variant='outline' size='sm' className='h-8 cursor-pointer px-3'>
                        查看
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
