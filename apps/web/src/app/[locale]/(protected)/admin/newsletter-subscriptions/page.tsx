'use client'

import { Loader2, PlusIcon, RefreshCwIcon, SearchIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { CreateNewsletterSubscriptionDialog } from './components/create-newsletter-subscription-dialog'
import { NewsletterSubscriptionsTable } from './components/newsletter-subscription-table'
import type { AdminNewsletterSubscriptionRow } from './types'

/**
 * Admin newsletter console: subscriber list, headline counters, hand-added
 * subscribers and manual edits.
 *
 * All reads go through `admin.newsletterSubscriptions.*`, which the app mounts
 * behind `adminProcedure`.
 */
export default function AdminNewsletterSubscriptionsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'subscribed' | 'unsubscribed'>('all')
  const [source, setSource] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)

  const debouncedSearch = useDebounce(search, 400)
  const isSearching = search !== debouncedSearch

  const { data, isLoading, refetch } = trpc.admin.newsletterSubscriptions.getNewsletterSubscriptionsPaginated.useQuery({
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    subscribed: status === 'all' ? undefined : status === 'subscribed',
    source: source === 'all' ? undefined : source,
  })

  const { data: statsData } = trpc.admin.newsletterSubscriptions.getNewsletterSubscriptionStats.useQuery()

  const utils = trpc.useUtils()
  const refresh = async () => {
    await Promise.all([
      utils.admin.newsletterSubscriptions.getNewsletterSubscriptionsPaginated.invalidate(),
      utils.admin.newsletterSubscriptions.getNewsletterSubscriptionStats.invalidate(),
    ])
  }

  const deleteMutation = trpc.admin.newsletterSubscriptions.deleteNewsletterSubscription.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('订阅已删除')
        await refresh()
      } else {
        toast.error(result.error || '删除失败')
      }
    },
    onError: (error) => toast.error(error.message || '删除失败'),
  })

  const rows = (data?.success ? data.data : []) as AdminNewsletterSubscriptionRow[]
  const total = data?.success ? data.pagination.total : 0
  const stats = statsData?.success ? statsData.data : null
  const hasFilters = Boolean(debouncedSearch) || status !== 'all' || source !== 'all'

  const resetFilters = () => {
    setSearch('')
    setStatus('all')
    setSource('all')
    setPage(1)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>邮件订阅管理</h1>
            <p className='text-muted-foreground'>管理邮件订阅名单、订阅状态和来源</p>
          </div>
          {isSearching && <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />}
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={() => refetch()}>
            <RefreshCwIcon className='mr-2 h-4 w-4' />
            刷新
          </Button>
          <Button className='cursor-pointer' onClick={() => setCreateOpen(true)}>
            <PlusIcon className='mr-2 h-4 w-4' />
            新增订阅
          </Button>
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardContent className='pt-6'>
            <p className='text-muted-foreground text-sm'>总订阅数</p>
            <p className='font-bold text-2xl tabular-nums'>
              {statsData ? stats?.total.toLocaleString('zh-CN') : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='pt-6'>
            <p className='text-muted-foreground text-sm'>已订阅</p>
            <p className='font-bold text-2xl tabular-nums'>
              {statsData ? stats?.subscribed.toLocaleString('zh-CN') : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='pt-6'>
            <p className='text-muted-foreground text-sm'>已退订</p>
            <p className='font-bold text-2xl tabular-nums'>
              {statsData ? stats?.unsubscribed.toLocaleString('zh-CN') : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='pt-6'>
            <p className='text-muted-foreground text-sm'>累计发送邮件</p>
            <p className='font-bold text-2xl tabular-nums'>
              {statsData ? stats?.totalEmailsSent.toLocaleString('zh-CN') : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative flex-1 sm:max-w-sm'>
          <SearchIcon className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            placeholder='搜索邮箱、来源或活动'
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            className='pl-9'
          />
          {search && (
            <Button
              variant='ghost'
              size='sm'
              className='absolute top-1/2 right-1 h-6 w-6 cursor-pointer p-0'
              onClick={() => {
                setSearch('')
                setPage(1)
              }}
            >
              <XIcon className='h-3 w-3' />
            </Button>
          )}
        </div>

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as typeof status)
            setPage(1)
          }}
        >
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部状态</SelectItem>
            <SelectItem value='subscribed'>已订阅</SelectItem>
            <SelectItem value='unsubscribed'>已退订</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={source}
          onValueChange={(value) => {
            setSource(value)
            setPage(1)
          }}
        >
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部来源</SelectItem>
            <SelectItem value='website'>网站</SelectItem>
            <SelectItem value='api'>API</SelectItem>
            <SelectItem value='import'>导入</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant='ghost' size='sm' className='cursor-pointer' onClick={resetFilters}>
            清除筛选
          </Button>
        )}
      </div>

      {hasFilters && (
        <p className='text-muted-foreground text-sm'>找到 {total.toLocaleString('zh-CN')} 个结果</p>
      )}

      <NewsletterSubscriptionsTable
        data={rows}
        page={page}
        pageSize={pageSize}
        total={total}
        loading={isLoading}
        deleting={deleteMutation.isPending}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        onConfirmDelete={(id) => deleteMutation.mutate({ id })}
        onUpdated={refresh}
      />

      <CreateNewsletterSubscriptionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={refresh}
      />
    </div>
  )
}
