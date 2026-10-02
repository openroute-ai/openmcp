'use client'

import { Loader2Icon, ShieldXIcon } from 'lucide-react'
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
import PaginationBox from '@/components/web/pagination-box'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils'
import { toFlags, type ReviewRecord } from '../types'

/**
 * Rejected submissions.
 *
 * 一行对应一次驳回记录（不是一个 skill）：同一个 skill 被自动驳回后又人工驳回，
 * 两次都值得看到，所以不按 skillId 折叠。搜索与分页都在服务端做——这个列表
 * 之前既没有搜索也没有分页，超过 200 条的部分会静默消失。
 */
export default function RejectedReviewsPage() {
  const [search, setSearch] = useState('')
  const [decision, setDecision] = useState<'all' | 'auto_reject' | 'reject'>('all')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const debouncedSearch = useDebounce(search, 400)

  const { data, isLoading } = trpc.admin.securityReview.getRejected.useQuery({
    search: debouncedSearch.trim() || undefined,
    decision,
    page,
    pageSize,
  })
  const records = (data?.success ? data.data : []) as ReviewRecord[]

  const filterKey = `${decision}|${debouncedSearch.trim()}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

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

      <div className='flex flex-wrap gap-3'>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='搜索 Skill 名称、slug 或创作者'
          className='max-w-sm'
        />
        <Select
          value={decision}
          onValueChange={(v) => setDecision(v as 'all' | 'auto_reject' | 'reject')}
        >
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部驳回</SelectItem>
            <SelectItem value='auto_reject'>仅自动驳回</SelectItem>
            <SelectItem value='reject'>仅人工驳回</SelectItem>
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
          {data?.success === true && (
            <div className='mt-4'>
              <PaginationBox page={page} count={data.total} pageSize={pageSize} onPageChange={setPage} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
