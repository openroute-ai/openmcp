'use client'

import { ClockIcon, FileArchiveIcon, GitBranchIcon, Loader2Icon, PackageIcon, SearchIcon, ShieldAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import PaginationBox from '@/components/web/pagination-box'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { formatWaiting, toFlags, type ReviewRecord } from '../types'

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
}

const TIER_CLASS: Record<number, string> = {
  1: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  2: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  3: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  4: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  5: 'bg-destructive/15 text-destructive',
}

/** Waiting longer than a day is called out; it means the queue is stuck. */
const STUCK_AFTER_MINUTES = 1440

/**
 * Manual security review queue.
 *
 * Search, source and trust-tier filtering all run in SQL, so the list is
 * already narrowed by the router. The source page also re-filtered the
 * returned array in the browser, which meant a search looked like it worked
 * while the server had been asked for an unfiltered 200 rows.
 */
export function ReviewQueuePage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | 'github' | 'zip'>('all')
  const [tier, setTier] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const pageSize = 20

  const debouncedSearch = useDebounce(search, 400)
  const utils = trpc.useUtils()

  const { data: queueData, isLoading } = trpc.admin.securityReview.getQueue.useQuery({
    source,
    trustTier: tier === 'all' ? undefined : Number(tier),
    search: debouncedSearch.trim() || undefined,
    page,
    pageSize,
  })

  const { data: statsData } = trpc.admin.securityReview.getStats.useQuery()

  // 换筛选条件时回到第一页，否则可能停在一个已经不存在的空页上
  const filterKey = `${source}|${tier}|${debouncedSearch.trim()}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const batchMutation = trpc.admin.securityReview.batchDecide.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        const { succeeded, failed } = result.data
        if (failed > 0) {
          toast.warning(`成功 ${succeeded} 条，失败 ${failed} 条`)
        } else {
          toast.success(`已处理 ${succeeded} 条`)
        }
        setSelected(new Set())
        await utils.admin.securityReview.getQueue.invalidate()
        await utils.admin.securityReview.getStats.invalidate()
      }
    },
    onError: (error) => toast.error(error.message || '批量审核失败'),
  })

  const records = (queueData?.success ? queueData.data : []) as ReviewRecord[]
  const stats = statsData?.success ? statsData.data : null

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => (prev.size === records.length ? new Set() : new Set(records.map((r) => r.id))))
  }

  const runBatch = (decision: 'pass' | 'reject') => {
    if (selected.size === 0) return
    batchMutation.mutate({
      ids: Array.from(selected),
      decision,
      comment: decision === 'pass' ? '批量通过' : '批量驳回',
    })
  }

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='flex items-center gap-2 font-bold text-2xl'>
          <ShieldAlertIcon className='size-6 text-primary' />
          安全复核队列
        </h1>
        <p className='text-muted-foreground'>等待人工复核的 Skill，扫描结果仅作参考，最终判定以此处为准</p>
      </div>

      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        <StatCard label='待复核' value={String(stats?.pending ?? 0)} className='text-orange-600' />
        <StatCard label='今日已处理' value={String(stats?.decidedToday ?? 0)} className='text-emerald-600' />
        <StatCard label='累计已处理' value={String(stats?.totalDecided ?? 0)} className='text-muted-foreground' />
        <StatCard label='自动驳回' value={String(stats?.autoRejected ?? 0)} className='text-destructive' />
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative flex-1 sm:max-w-xs'>
          <SearchIcon className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            placeholder='搜索 Skill 名称 / slug / 创作者'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='pl-9'
          />
        </div>
        <Select value={source} onValueChange={(value) => setSource(value as 'all' | 'github' | 'zip')}>
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部来源</SelectItem>
            <SelectItem value='github'>GitHub</SelectItem>
            <SelectItem value='zip'>ZIP 上传</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部层级</SelectItem>
            {[1, 2, 3, 4, 5].map((level) => (
              <SelectItem key={level} value={String(level)}>
                Tier {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className='flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3'>
          <span className='font-medium text-sm'>已选 {selected.size} 条</span>
          <Button
            variant='outline'
            size='sm'
            className='cursor-pointer'
            onClick={() => runBatch('pass')}
            disabled={batchMutation.isPending}
          >
            批量通过
          </Button>
          <Button
            variant='destructive'
            size='sm'
            className='cursor-pointer'
            onClick={() => runBatch('reject')}
            disabled={batchMutation.isPending}
          >
            批量驳回
          </Button>
          <Button variant='ghost' size='sm' className='cursor-pointer' onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className='flex items-center justify-center gap-2 py-16 text-muted-foreground'>
            <Loader2Icon className='size-5 animate-spin' />
            加载中...
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center gap-3 py-16'>
            <PackageIcon className='size-10 text-muted-foreground' />
            <p className='font-medium text-muted-foreground'>队列已清空，没有待复核的 Skill</p>
          </CardContent>
        </Card>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>
                  <Checkbox
                    checked={records.length > 0 && selected.size === records.length}
                    onCheckedChange={toggleAll}
                    aria-label='全选'
                  />
                </TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>创作者</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>信任层级</TableHead>
                <TableHead>命中 flag</TableHead>
                <TableHead>LLM 评级</TableHead>
                <TableHead>等待时长</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => {
                const flags = toFlags(record.flags)
                return (
                  <TableRow key={record.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(record.id)}
                        onCheckedChange={() => toggleSelect(record.id)}
                        aria-label={`选择 ${record.title}`}
                      />
                    </TableCell>
                    <TableCell>
                      <p className='font-medium text-sm'>{record.title}</p>
                      <p className='font-mono text-muted-foreground text-xs'>{record.slug}</p>
                    </TableCell>
                    <TableCell className='text-sm'>
                      {record.authorName}
                      <p className='text-muted-foreground text-xs'>@{record.authorUsername}</p>
                    </TableCell>
                    <TableCell>
                      {record.sourceType === 'github' ? (
                        <span className='flex items-center gap-1 text-sm'>
                          <GitBranchIcon className='size-3.5' />
                          GitHub
                        </span>
                      ) : (
                        <span className='flex items-center gap-1 text-sm'>
                          <FileArchiveIcon className='size-3.5' />
                          ZIP
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 font-medium text-xs ${
                          TIER_CLASS[record.trustTier ?? 5] ?? TIER_CLASS[5]
                        }`}
                      >
                        Tier {record.trustTier ?? '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-1'>
                        {flags.slice(0, 3).map((flag, index) => (
                          <span
                            key={`${flag.name}-${index}`}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              SEVERITY_CLASS[flag.severity] ?? SEVERITY_CLASS.low
                            }`}
                          >
                            {flag.name}
                          </span>
                        ))}
                        {flags.length > 3 && (
                          <span className='text-muted-foreground text-xs'>+{flags.length - 3}</span>
                        )}
                        {flags.length === 0 && (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {record.llmGrade ? (
                        <Badge variant='outline'>{record.llmGrade}</Badge>
                      ) : (
                        <span className='text-muted-foreground text-xs'>—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`flex items-center gap-1 text-sm ${
                          record.waitingMinutes > STUCK_AFTER_MINUTES
                            ? 'font-medium text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        <ClockIcon className='size-3.5' />
                        {formatWaiting(record.waitingMinutes)}
                      </span>
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='outline'
                        size='sm'
                        className='h-8 cursor-pointer px-3'
                        onClick={() => router.push(`/admin/security-review/${record.id}`)}
                      >
                        审核
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {queueData?.success === true && (
            <div className='mt-4'>
              <PaginationBox
                page={page}
                count={queueData.total}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className='rounded-lg border p-4'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className={`mt-1 font-bold text-2xl tabular-nums ${className ?? ''}`}>{value}</p>
    </div>
  )
}
