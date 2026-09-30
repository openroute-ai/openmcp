'use client'

import { HistoryIcon, Loader2Icon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils'
import type { ReviewRecord } from '../types'

/**
 * Full decision history.
 *
 * Unlike the rejected list this is one row per review record, not per skill:
 * the point is to see every decision that was ever made, including the ones
 * later superseded.
 */
export function ReviewHistoryPage() {
  const [search, setSearch] = useState('')
  const [decision, setDecision] = useState<'all' | 'pass' | 'reject' | 'needs_revision'>('all')
  const debouncedSearch = useDebounce(search, 400)

  const { data, isLoading } = trpc.admin.securityReview.getHistory.useQuery({
    decision,
    search: debouncedSearch.trim() || undefined,
  })

  const records = (data?.success ? data.data : []) as ReviewRecord[]

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='flex items-center gap-2 font-bold text-2xl'>
          <HistoryIcon className='size-6 text-primary' />
          审核历史
        </h1>
        <p className='text-muted-foreground'>所有已完成的审核决定，可按结果和关键词筛选</p>
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative flex-1 sm:max-w-sm'>
          <SearchIcon className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            placeholder='搜索 Skill 名称、创作者或审核人'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='pl-9'
          />
        </div>
        <Select value={decision} onValueChange={(value) => setDecision(value as typeof decision)}>
          <SelectTrigger size='sm' className='w-36 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部结果</SelectItem>
            <SelectItem value='pass'>通过</SelectItem>
            <SelectItem value='reject'>驳回</SelectItem>
            <SelectItem value='needs_revision'>要求修改</SelectItem>
          </SelectContent>
        </Select>
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
          <CardContent className='py-16 text-center text-muted-foreground'>暂无审核记录</CardContent>
        </Card>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>创作者</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>审核意见</TableHead>
                <TableHead>审核人</TableHead>
                <TableHead>耗时</TableHead>
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
                    <Badge variant={record.decision === 'pass' ? 'default' : 'destructive'}>
                      {record.decision === 'pass'
                        ? '通过'
                        : record.decision === 'reject'
                          ? '驳回'
                          : '要求修改'}
                    </Badge>
                  </TableCell>
                  <TableCell className='max-w-64 truncate text-sm' title={record.reviewComment ?? ''}>
                    {record.reviewComment || '-'}
                  </TableCell>
                  <TableCell className='text-sm'>{record.reviewerName || '系统'}</TableCell>
                  <TableCell className='text-sm'>
                    {record.durationMinutes != null ? `${record.durationMinutes} 分钟` : '-'}
                  </TableCell>
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
