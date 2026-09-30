'use client'

import { Loader2, SearchIcon, XIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
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
import { SessionStatsCards } from './components/session-stats-cards'
import { SessionsTable } from './components/sessions-table'
import { RevokeSessionDialog } from './components/revoke-session-dialog'
import type { AdminSessionRow } from './types'

/**
 * Admin session console.
 *
 * Reads `?search=` on mount so the user detail page can deep-link here
 * pre-filtered to one account; `useSearchParams` requires a Suspense boundary,
 * which the route provides.
 */
export default function AdminSessionsPage() {
  return (
    <Suspense>
      <AdminSessionsPageInner />
    </Suspense>
  )
}

function AdminSessionsPageInner() {
  const searchParams = useSearchParams()
  const initialSearch = searchParams.get('search') ?? ''

  const [search, setSearch] = useState(initialSearch)
  const [active, setActive] = useState<'all' | 'active' | 'expired'>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [revokeTarget, setRevokeTarget] = useState<AdminSessionRow | null>(null)

  const debouncedSearch = useDebounce(search, 400)
  const isSearching = search !== debouncedSearch

  const { data, isLoading, refetch } = trpc.admin.sessions.getSessions.useQuery({
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    active: active === 'all' ? undefined : active === 'active',
  })

  const utils = trpc.useUtils()
  const revokeMutation = trpc.admin.sessions.deleteSession.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('会话已吊销')
        setRevokeTarget(null)
        await utils.admin.sessions.getSessions.invalidate()
        await utils.admin.sessions.getSessionsStats.invalidate()
      }
    },
    onError: (error) => toast.error(error.message || '吊销会话失败'),
  })

  const sessions = (data?.success ? data.data : []) as AdminSessionRow[]
  const total = data?.success ? data.pagination.total : 0
  const hasFilters = Boolean(debouncedSearch) || active !== 'all'

  const resetFilters = () => {
    setSearch('')
    setActive('all')
    setPage(1)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>会话管理</h1>
            <p className='text-muted-foreground'>
              查看登录状态、IP 地址和用户代理，可吊销可疑会话
            </p>
          </div>
          {isSearching && <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />}
        </div>
        <Button variant='outline' onClick={() => refetch()}>
          刷新
        </Button>
      </div>

      <SessionStatsCards />

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative flex-1 sm:max-w-sm'>
          <SearchIcon className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            placeholder='搜索 IP、用户代理、用户名或邮箱'
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
              className='absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 cursor-pointer p-0'
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
          value={active}
          onValueChange={(value) => {
            setActive(value as 'all' | 'active' | 'expired')
            setPage(1)
          }}
        >
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部状态</SelectItem>
            <SelectItem value='active'>活跃</SelectItem>
            <SelectItem value='expired'>已过期</SelectItem>
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

      <SessionsTable
        data={sessions}
        page={page}
        pageSize={pageSize}
        total={total}
        loading={isLoading}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        onRevoke={setRevokeTarget}
      />

      <RevokeSessionDialog
        session={revokeTarget}
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        onConfirm={() => {
          if (revokeTarget) revokeMutation.mutate({ id: revokeTarget.id })
        }}
        isLoading={revokeMutation.isPending}
      />
    </div>
  )
}
